// 写入走 Media Companion 插件自带的本地 API（上游功能，非 fork 改动）。
// 选型记录见 spec 组件 3。两条铁律：
//  1. adapter 绝不自己写 sidecar —— MC 生成，双写与其文件监听撞车；
//  2. 来源信息（sourceUrl/sourceTitle）必须随 upload 请求进，否则 MC
//     的 sidecar 里就没有它们。

const DEFAULT_PORT = 27124; // 与 obsidian-local-rest-api 默认 HTTPS 端口重合；两边均可配

export function mcUploadBody(item, folder) {
	return {
		imageBase64: item.base64,
		filename: item.filename,
		folder,
		tags: [], // 捕获时一律不打标（spec 使用约定）
		sourceUrl: item.sourceUrl,
		sourceTitle: item.sourceTitle,
	};
}

function base(cfg) {
	return `http://127.0.0.1:${cfg.port || DEFAULT_PORT}`;
}

function authHeaders(cfg) {
	return cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
}

// 本地写盘无平台上限；捕获端 50MB 的护栏在 background.js 里已有
const CAPS = { maxFileSize: Infinity };

export const obsidianAdapter = {
	id: "obsidian",

	async test(cfg) {
		let res;
		try {
			res = await fetch(`${base(cfg)}/api/ping`, { headers: authHeaders(cfg) });
		} catch {
			// 连不上 = Obsidian 没开，或 MC 的 API 开关没打开
			return { ok: false, errorKey: "errObsidianClosed" };
		}
		if (res.status === 401) return { ok: false, errorKey: "errObsidianKey" };
		if (!res.ok) return { ok: false, errorKey: "errObsidianGeneric" };
		return { ok: true, capabilities: CAPS };
	},

	capabilities() {
		return CAPS;
	},

	async save(item, cfg) {
		let res;
		try {
			res = await fetch(`${base(cfg)}/api/upload`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...authHeaders(cfg) },
				body: JSON.stringify(mcUploadBody(item, cfg.folder)),
			});
		} catch {
			throw { errorKey: "errObsidianClosed" };
		}
		if (res.status === 401) throw { errorKey: "errObsidianKey", status: 401 };
		if (!res.ok) throw { errorKey: "errObsidianGeneric", status: res.status };
	},
};
