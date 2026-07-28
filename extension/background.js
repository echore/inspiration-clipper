import { upload, ping } from "./lib/upload.js";
import { buildUploadBody, friendlyError } from "./lib/helpers.js";
import { LOCAL } from "./config.local.js";

export async function showToast(tabId, text, ok) {
	try {
		await chrome.scripting.executeScript({ target: { tabId }, files: ["content-toast.js"] });
		await chrome.tabs.sendMessage(tabId, { action: "inspToast", text, ok });
	} catch (e) {
		console.warn("[insp] toast failed:", e);
	}
}

export async function saveToLibrary(tabId, { imageBase64, title, sourceUrl }) {
	try {
		await upload(buildUploadBody({ imageBase64, title, sourceUrl, folder: LOCAL.folder, now: Date.now() }));
		await showToast(tabId, "已存入灵感库 ✓", true);
	} catch (e) {
		await showToast(tabId, friendlyError(e), false);
	}
}

async function startRegionCapture(tab) {
	if (!tab?.id) return;
	let dataUrl;
	try {
		dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
	} catch (e) {
		await showToast(tab.id, "这个页面截不了图（浏览器保护页），换个页面试试", false);
		return;
	}
	await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-overlay.js"] });
	await chrome.tabs.sendMessage(tab.id, { action: "inspShowOverlay", dataUrl });
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
				await chrome.tabs.sendMessage(tabId, { action: "inspCaptureDone" });
				await saveToLibrary(tabId, { imageBase64: b64, title: msg.title, sourceUrl: msg.source_url });
			} catch (e) {
				await chrome.tabs.sendMessage(tabId, { action: "inspCaptureDone" }).catch(() => {});
				await showToast(tabId, "没存上，重试一下；连续失败请点扩展图标看状态", false);
			}
		})();
	}

	if (msg?.action === "inspStartCapture") {
		chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => startRegionCapture(tab));
	}
});
