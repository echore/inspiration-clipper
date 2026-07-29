// extension/lib/capture-item.js — 捕获层与适配器层之间的唯一载体。纯函数，无 chrome API。
import { sanitizeTitle, buildFilename, byteLengthFromBase64 } from "./helpers.js";

export function makeCaptureItem({ base64, ext, mime, title, sourceUrl, now }) {
	return {
		base64,
		ext,
		mime,
		filename: buildFilename(title, now, ext),
		title,
		sourceTitle: sanitizeTitle(title),
		sourceUrl: sourceUrl || "",
		capturedAt: now,
		byteLength: byteLengthFromBase64(base64),
	};
}
