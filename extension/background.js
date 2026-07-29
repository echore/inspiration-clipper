import { makeCaptureItem } from "./lib/capture-item.js";
import { chooseDestination } from "./lib/router.js";
import { getAdapter } from "./lib/adapters/index.js";
import { loadSettings, probeAll } from "./lib/settings.js";
import { extFromContentType, pickExt } from "./lib/helpers.js";
import { t } from "./lib/i18n.js";

export async function showToast(tabId, text, ok) {
	try {
		await chrome.scripting.executeScript({ target: { tabId }, files: ["content-toast.js"] });
		await chrome.tabs.sendMessage(tabId, { action: "inspToast", text, ok });
	} catch (e) {
		console.warn("[insp] toast failed:", e);
		// executeScript is blocked on protected pages (chrome://, Web Store, PDF viewer);
		// fall back to a badge flash so failures are never fully silent there.
		try {
			await chrome.action.setBadgeText({ text: ok ? "✓" : "✗", tabId });
			await chrome.action.setBadgeBackgroundColor({ color: ok ? "#22c55e" : "#ef4444", tabId });
			setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }).catch(() => {}), 3000);
		} catch (e2) {
			console.warn("[insp] badge fallback failed:", e2);
		}
	}
}

const MIME_BY_EXT = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
	avif: "image/avif", bmp: "image/bmp", gif: "image/gif", svg: "image/svg+xml",
	mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg",
};

export async function saveToLibrary(tabId, { base64, ext = "png", title, sourceUrl }) {
	const item = makeCaptureItem({
		base64, ext, mime: MIME_BY_EXT[ext] ?? "application/octet-stream",
		title, sourceUrl, now: Date.now(),
	});
	const settings = await loadSettings();
	const caps = await probeAll();
	const decision = chooseDestination(item, settings.chain, caps);

	if (decision.error === "noDestination") {
		await showToast(tabId, t("errNoDestination"), false);
		return;
	}
	if (decision.error === "tooLargeForAll") {
		await showToast(tabId, t("errTooLarge", [mb(decision.byteLength), mb(decision.maxFileSize)]), false);
		return;
	}

	const adapter = getAdapter(decision.adapterId);
	try {
		await adapter.save(item, settings.byAdapter[decision.adapterId]);
		const msg = decision.degradedFrom
			? t("okSavedDegraded", [t(`dest_${decision.adapterId}`), t(`dest_${decision.degradedFrom}`)])
			: t("okSaved", [t(`dest_${decision.adapterId}`)]);
		await showToast(tabId, msg, true);
	} catch (e) {
		await showToast(tabId, t(e?.errorKey ?? "errGeneric"), false);
	}
}

function mb(bytes) {
	return (bytes / 1024 / 1024).toFixed(1);
}

async function startRegionCapture(tab) {
	if (!tab?.id) return;
	let dataUrl;
	try {
		dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
	} catch (e) {
		const msg = e?.message ?? "";
		if (/quota|per second|MAX_CAPTURE/i.test(msg)) {
			await showToast(tab.id, "截太快了，等一秒再试", false);
		} else {
			await showToast(tab.id, "这个页面截不了图（浏览器保护页），换个页面试试", false);
		}
		return;
	}
	try {
		await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-overlay.js"] });
		await chrome.tabs.sendMessage(tab.id, { action: "inspShowOverlay", dataUrl });
	} catch (e) {
		// capture worked but injection didn't (file:// without access, tab navigated
		// away mid-flight) — showToast's badge fallback covers uninjectable pages.
		await showToast(tab.id, "这个页面框选不了（脚本进不去），换个页面试试", false);
	}
}

chrome.commands.onCommand.addListener(async (command, tab) => {
	if (command === "capture-region") await startRegionCapture(tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
});

// 图标点击也走截图（popup 存在时不触发 onClicked，故图标主入口是 popup；此处给无 popup 场景兜底）

async function cropImage(dataUrl, rect, dpr) {
	const blob = await (await fetch(dataUrl)).blob();
	const sx = Math.round(rect.x * dpr), sy = Math.round(rect.y * dpr);
	const sw = Math.round(rect.width * dpr), sh = Math.round(rect.height * dpr);
	const bitmap = await createImageBitmap(blob, sx, sy, sw, sh);
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	canvas.getContext("2d").drawImage(bitmap, 0, 0);
	const out = await canvas.convertToBlob({ type: "image/png" });
	const buf = await out.arrayBuffer();
	let bin = "";
	const bytes = new Uint8Array(buf);
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

// popup 状态查询 + 区域框选截图流
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.action === "inspPing") {
		ping().then((ok) => sendResponse({ ok }));
		return true;
	}

	if (msg?.action === "inspRegionSelected" && sender.tab?.id) {
		const tabId = sender.tab.id;
		(async () => {
			try {
				const b64 = await cropImage(msg.dataUrl, msg.rect, msg.dpr);
				// Overlay may be gone already (user navigated mid-crop) — the crop
				// succeeded, so dismiss failure must not abort the save.
				await chrome.tabs.sendMessage(tabId, { action: "inspCaptureDone" }).catch(() => {});
				await saveToLibrary(tabId, { base64: b64, ext: "png", title: msg.title, sourceUrl: msg.source_url });
			} catch (e) {
				await chrome.tabs.sendMessage(tabId, { action: "inspCaptureDone" }).catch(() => {});
				await showToast(tabId, "没存上，重试一下；连续失败请点扩展图标看状态", false);
			}
		})();
	}

	if (msg?.action === "inspStartCapture") {
		chrome.tabs.query({ active: true, currentWindow: true })
			.then(([tab]) => startRegionCapture(tab))
			.catch((e) => console.warn("[insp] start capture failed:", e));
	}
});

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({
			id: "insp-save-image",
			title: "存入灵感库",
			contexts: ["image", "video"],
		});
	});
});

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50MB — keep the SW from dying mid-encode on huge videos

async function fetchMediaAsBase64(srcUrl) {
	const res = await fetch(srcUrl);
	if (!res.ok) throw { status: res.status };
	const len = res.headers.get("content-length");
	if (len && Number(len) > MAX_MEDIA_BYTES) throw { tooLarge: true };
	const buf = await res.arrayBuffer();
	if (buf.byteLength > MAX_MEDIA_BYTES) throw { tooLarge: true };
	let bin = "";
	const bytes = new Uint8Array(buf);
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	}
	// res.url is the post-redirect URL — share links often 302 to the real file,
	// whose path carries the extension the original URL lacks.
	return { b64: btoa(bin), contentType: res.headers.get("content-type"), finalUrl: res.url || srcUrl };
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
	if (info.menuItemId !== "insp-save-image" || !tab?.id) return;
	(async () => {
		// MSE-driven <video> (and some <source> setups) expose no srcUrl
		if (!info.srcUrl) {
			await showToast(tab.id, "这个媒体拿不到地址，存不了原件；用框选截一帧吧（Alt+Shift+S）", false);
			return;
		}
		if (info.srcUrl.startsWith("blob:")) {
			await showToast(tab.id, "这是流媒体，存不了原件；用框选截一帧吧（Alt+Shift+S）", false);
			return;
		}
		// data: URL 的图直接取，无需权限（仅支持 base64 编码；其他编码如裸 svg+xml 不解析）
		if (info.srcUrl.startsWith("data:")) {
			const match = info.srcUrl.match(/^data:([^;,]+)?;base64,/);
			if (!match) {
				await showToast(tab.id, "这种内嵌图存不了，用框选截图吧（Alt+Shift+S）", false);
				return;
			}
			const mime = match[1] || null;
			const dataExt = extFromContentType(mime);
			if (!dataExt) {
				await showToast(tab.id, "认不出这张图的格式，用框选截图吧（Alt+Shift+S）", false);
				return;
			}
			const b64 = info.srcUrl.slice(match[0].length);
			await saveToLibrary(tab.id, {
				base64: b64,
				title: tab.title ?? "clip",
				sourceUrl: info.pageUrl ?? "",
				ext: dataExt,
			});
			return;
		}
		// 用户手势窗口内申请该图源域名的权限（首次一问，之后静默）
		let origin;
		try {
			origin = new URL(info.srcUrl).origin + "/*";
		} catch {
			await showToast(tab.id, "这张图的地址不认识，用框选截图吧（Alt+Shift+S）", false);
			return;
		}
		const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
		if (!granted) {
			await showToast(tab.id, "没拿到读图权限，用框选截图吧（Alt+Shift+S）", false);
			return;
		}
		try {
			const { b64, contentType, finalUrl } = await fetchMediaAsBase64(info.srcUrl);
			const ext = pickExt(contentType, finalUrl);
			if (!ext) {
				await showToast(tab.id, "认不出这个文件的格式，用框选截图吧（Alt+Shift+S）", false);
				return;
			}
			await saveToLibrary(tab.id, {
				base64: b64,
				title: tab.title ?? "clip",
				sourceUrl: info.pageUrl ?? info.srcUrl,
				ext,
			});
		} catch (e) {
			if (e?.tooLarge) {
				await showToast(tab.id, "文件太大（超过 50MB），存不了；试试框选截图（Alt+Shift+S）", false);
				return;
			}
			await showToast(tab.id, "原图拿不到（站点防盗链），用框选截图吧（Alt+Shift+S）", false);
		}
	})();
});
