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

// 建库请求体。API 版本 2025-09-03 起 schema 必须嵌在 initial_data_source 下
// (数据库变成了数据源的容器),顶层 properties 会被拒。
export function createDatabasePayload(parentPageId, title) {
	return {
		parent: { type: "page_id", page_id: parentPageId },
		title: [{ type: "text", text: { content: title } }],
		initial_data_source: {
			properties: {
				[NOTION_PROPS.name]: { title: {} },
				[NOTION_PROPS.image]: { files: {} },
				[NOTION_PROPS.sourceUrl]: { url: {} },
				[NOTION_PROPS.sourceTitle]: { rich_text: {} },
				[NOTION_PROPS.captured]: { date: {} },
			},
		},
	};
}

// search 结果 → { id, title } 列表。title 属性的键名随页面模板变,按 type 找。
export function mapSearchResults(json) {
	const results = Array.isArray(json?.results) ? json.results : [];
	return results
		.filter((r) => r?.object === "page")
		.map((r) => {
			let title = "";
			for (const prop of Object.values(r.properties ?? {})) {
				if (prop?.type === "title") {
					title = (prop.title ?? []).map((seg) => seg?.plain_text ?? "").join("");
					break;
				}
			}
			return { id: r.id, title };
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

	async searchPages(cfg) {
		try {
			const res = await fetch(`${API}/search`, {
				method: "POST",
				headers: { ...headers(cfg), "Content-Type": "application/json" },
				body: JSON.stringify({ filter: { value: "page", property: "object" }, page_size: 20 }),
			});
			if (res.status === 401) return { ok: false, errorKey: "errNotionToken" };
			if (!res.ok) return { ok: false, errorKey: "errNotionGeneric" };
			const pages = mapSearchResults(await res.json());
			if (pages.length === 0) return { ok: false, errorKey: "errNotionSearchEmpty" };
			return { ok: true, pages };
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
	},

	async createDatabase(cfg, parentPageId, title) {
		let res;
		try {
			res = await fetch(`${API}/databases`, {
				method: "POST",
				headers: { ...headers(cfg), "Content-Type": "application/json" },
				body: JSON.stringify(createDatabasePayload(parentPageId, title)),
			});
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
		if (!res.ok) return { ok: false, errorKey: "errNotionCreateDb" };
		const json = await res.json();
		return { ok: true, databaseId: json.id };
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
