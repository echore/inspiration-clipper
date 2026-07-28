// extension/lib/helpers.js — 纯函数，无 chrome API，可被 node --test 直接测
export function sanitizeTitle(title) {
	const cleaned = (title || "").replace(/[/\\:*?"<>|#[\]]/g, "").trim().slice(0, 60);
	return cleaned || "clip";
}

export function buildFilename(title, now, ext = "png") {
	return `${sanitizeTitle(title)}-${now}.${ext}`;
}

export function buildUploadBody({ imageBase64, title, sourceUrl, folder, now, ext = "png" }) {
	return {
		imageBase64,
		filename: buildFilename(title, now, ext),
		folder,
		tags: [],
		sourceUrl,
		sourceTitle: sanitizeTitle(title),
	};
}

const MEDIA_EXTS = new Set(["png", "jpg", "jpeg", "webp", "avif", "bmp", "gif", "mp4", "webm", "mov", "ogv"]);

const CONTENT_TYPE_EXT = {
	"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
	"image/avif": "avif", "image/bmp": "bmp", "image/gif": "gif",
	"video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
};

export function extFromContentType(ct) {
	if (!ct) return null;
	return CONTENT_TYPE_EXT[ct.split(";")[0].trim().toLowerCase()] ?? null;
}

export function extFromUrl(url) {
	try {
		const path = new URL(url).pathname;
		const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "";
		return MEDIA_EXTS.has(ext) ? ext : null;
	} catch {
		return null;
	}
}

export function pickExt(contentType, url) {
	return extFromContentType(contentType) ?? extFromUrl(url) ?? "png";
}

export function friendlyError(e) {
	if (e && e.networkError) return "Obsidian（creation-flywheel）没开，这张没存上";
	if (e && e.status === 401) return "连接钥匙对不上，重跑 setup-key 脚本试试";
	return "没存上，重试一下；连续失败请点扩展图标看状态";
}
