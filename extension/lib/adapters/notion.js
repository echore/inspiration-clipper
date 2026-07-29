// 三步上传：建 file_upload 对象 → 传字节 → 建 database page 引用它。
// 属性名必须与 spec「组件 4」的 Notion 模板一致。

const API = "https://api.notion.com/v1";
const VERSION = "2026-03-11";
const FREE_TIER_LIMIT = 5 * 1024 * 1024;

export function notionCapsFromBotUser(json) {
	const n = json?.bot?.workspace_limits?.max_file_upload_size_in_bytes;
	// 读不到就按免费版的 5MB 算。保守取小 —— 误降级到 Obsidian 只是位置不同，
	// 高估上限则是传到一半才失败。
	return { maxFileSize: typeof n === "number" ? n : FREE_TIER_LIMIT };
}

export function notionPageProperties(item, fileUploadId) {
	return {
		Name: { title: [{ text: { content: item.filename } }] },
		Image: { type: "files", files: [{ type: "file_upload", file_upload: { id: fileUploadId }, name: item.filename }] },
		"Source URL": { url: item.sourceUrl || null },
		"Source Title": { rich_text: [{ text: { content: item.sourceTitle } }] },
		Captured: { date: { start: new Date(item.capturedAt).toISOString() } },
	};
}

function headers(cfg) {
	return { Authorization: `Bearer ${cfg.token}`, "Notion-Version": VERSION };
}

function blobFromBase64(b64, mime) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type: mime });
}

let cachedCaps = { maxFileSize: FREE_TIER_LIMIT };

export const notionAdapter = {
	id: "notion",

	async test(cfg) {
		if (!cfg.token || !cfg.databaseId) return { ok: false, errorKey: "errNotionUnconfigured" };
		try {
			const res = await fetch(`${API}/users/me`, { headers: headers(cfg) });
			if (res.status === 401) return { ok: false, errorKey: "errNotionToken" };
			if (!res.ok) return { ok: false, errorKey: "errNotionGeneric" };
			cachedCaps = notionCapsFromBotUser(await res.json());
			return { ok: true, capabilities: cachedCaps };
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
	},

	capabilities() {
		return cachedCaps;
	},

	async save(item, cfg) {
		let createRes;
		try {
			createRes = await fetch(`${API}/file_uploads`, {
				method: "POST",
				headers: { ...headers(cfg), "Content-Type": "application/json" },
				body: JSON.stringify({ filename: item.filename, content_type: item.mime }),
			});
		} catch {
			throw { errorKey: "errNotionUnreachable" };
		}
		if (!createRes.ok) throw { errorKey: "errNotionGeneric", status: createRes.status };
		const { id, upload_url } = await createRes.json();

		const form = new FormData();
		form.append("file", blobFromBase64(item.base64, item.mime), item.filename);
		// 不要手写 Content-Type：boundary 必须由 FormData 自己生成
		let sendRes;
		try {
			sendRes = await fetch(upload_url, { method: "POST", headers: headers(cfg), body: form });
		} catch {
			throw { errorKey: "errNotionUnreachable" };
		}
		if (!sendRes.ok) throw { errorKey: "errNotionUploadFailed", status: sendRes.status };

		let pageRes;
		try {
			pageRes = await fetch(`${API}/pages`, {
				method: "POST",
				headers: { ...headers(cfg), "Content-Type": "application/json" },
				body: JSON.stringify({
					parent: { database_id: cfg.databaseId },
					properties: notionPageProperties(item, id),
				}),
			});
		} catch {
			throw { errorKey: "errNotionUnreachable" };
		}
		if (!pageRes.ok) throw { errorKey: "errNotionPageFailed", status: pageRes.status };
	},
};
