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

// 属性名五件套:建库 schema 和写入条目共用,改一处两边同步。
export const NOTION_PROPS = {
	name: "Name",
	image: "Image",
	sourceUrl: "Source URL",
	sourceTitle: "Source Title",
	captured: "Captured",
};

export function notionPageProperties(item, fileUploadId) {
	return {
		[NOTION_PROPS.name]: { title: [{ text: { content: item.filename } }] },
		[NOTION_PROPS.image]: { type: "files", files: [{ type: "file_upload", file_upload: { id: fileUploadId }, name: item.filename }] },
		[NOTION_PROPS.sourceUrl]: { url: item.sourceUrl || null },
		[NOTION_PROPS.sourceTitle]: { rich_text: [{ text: { content: item.sourceTitle } }] },
		[NOTION_PROPS.captured]: { date: { start: new Date(item.capturedAt).toISOString() } },
	};
}

// search 结果(filter=data_source)→ 可连接的库列表。库由用户从模板复制,
// 扩展只负责认出它:必须挂在某个 database 下,且五列齐全(缺列记进 missing,
// 让 UI 能指名道姓地提示;接口没回 schema 时不妄下判断)。
export function mapDataSourceResults(json) {
	const results = Array.isArray(json?.results) ? json.results : [];
	return results
		.filter((r) => r?.object === "data_source" && r?.parent?.database_id)
		.map((r) => {
			const title = (r.title ?? []).map((seg) => seg?.plain_text ?? "").join("");
			const keys = r.properties ? Object.keys(r.properties) : null;
			const missing = keys ? Object.values(NOTION_PROPS).filter((p) => !keys.includes(p)) : [];
			return { databaseId: r.parent.database_id, title, missing };
		});
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

	async verifyToken(cfg) {
		// 向导 N1 用:此时还没有 databaseId,只验钥匙本身
		if (!cfg?.token) return { ok: false, errorKey: "errNotionToken" };
		try {
			const res = await fetch(`${API}/users/me`, { headers: headers(cfg) });
			if (res.status === 401) return { ok: false, errorKey: "errNotionToken" };
			if (!res.ok) return { ok: false, errorKey: "errNotionGeneric" };
			cachedCaps = notionCapsFromBotUser(await res.json());
			return { ok: true };
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
	},

	async test(cfg) {
		if (!cfg.token || !cfg.databaseId) return { ok: false, errorKey: "errNotionUnconfigured" };
		const tokenCheck = await this.verifyToken(cfg);
		if (!tokenCheck.ok) return tokenCheck;
		// 第二段:库真的可见吗?token 对但库没分享给 integration 时,
		// 只验 token 会假绿灯,存的时候才炸——这里就拦住。
		try {
			const res = await fetch(`${API}/databases/${cfg.databaseId}`, { headers: headers(cfg) });
			if (!res.ok) return { ok: false, errorKey: "errNotionDatabase" };
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
		return { ok: true, capabilities: cachedCaps };
	},

	async searchDataSources(cfg) {
		try {
			const res = await fetch(`${API}/search`, {
				method: "POST",
				headers: { ...headers(cfg), "Content-Type": "application/json" },
				body: JSON.stringify({ filter: { value: "data_source", property: "object" }, page_size: 20 }),
			});
			if (res.status === 401) return { ok: false, errorKey: "errNotionToken" };
			if (!res.ok) return { ok: false, errorKey: "errNotionGeneric" };
			const sources = mapDataSourceResults(await res.json());
			if (sources.length === 0) return { ok: false, errorKey: "errNotionSearchEmpty" };
			return { ok: true, sources };
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
