// extension/lib/helpers.js — 纯函数，无 chrome API，可被 node --test 直接测
export function sanitizeTitle(title) {
	const cleaned = (title || "").replace(/[/\\:*?"<>|#[\]]/g, "").trim().slice(0, 60);
	return cleaned || "clip";
}

export function buildFilename(title, now, ext = "png") {
	return `${sanitizeTitle(title)}-${now}.${ext}`;
}

const MEDIA_EXTS = new Set(["png", "jpg", "jpeg", "webp", "avif", "bmp", "gif", "svg", "mp4", "webm", "mov", "ogv"]);

const CONTENT_TYPE_EXT = {
	"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
	"image/avif": "avif", "image/bmp": "bmp", "image/gif": "gif", "image/svg+xml": "svg",
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

// null when neither source identifies the format — caller must refuse rather
// than write unknown bytes under a made-up extension (false-success is worse
// than a visible failure).
export function pickExt(contentType, url) {
	return extFromContentType(contentType) ?? extFromUrl(url) ?? null;
}

// base64 解码后的真实字节数。路由层用它判断是否超过目的地上限，
// 不能用 b64.length 近似 —— 33% 的膨胀会让 5MB 的门槛误判。
export function byteLengthFromBase64(b64) {
	if (!b64) return 0;
	const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
	return Math.floor((b64.length * 3) / 4) - padding;
}
