// extension/lib/helpers.js — 纯函数，无 chrome API，可被 node --test 直接测
export function sanitizeTitle(title) {
	const cleaned = (title || "").replace(/[/\\:*?"<>|#[\]]/g, "").trim().slice(0, 60);
	return cleaned || "clip";
}

export function buildFilename(title, now) {
	return `${sanitizeTitle(title)}-${now}.png`;
}

export function buildUploadBody({ imageBase64, title, sourceUrl, folder, now }) {
	return {
		imageBase64,
		filename: buildFilename(title, now),
		folder,
		tags: [],
		sourceUrl,
		sourceTitle: sanitizeTitle(title),
	};
}

export function friendlyError(e) {
	if (e && e.networkError) return "Obsidian（creation-flywheel）没开，这张没存上";
	if (e && e.status === 401) return "连接钥匙对不上，重跑 setup-key 脚本试试";
	return "没存上，重试一下；连续失败请点扩展图标看状态";
}
