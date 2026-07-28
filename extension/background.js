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

// popup 状态查询
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.action === "inspPing") {
		ping().then((ok) => sendResponse({ ok }));
		return true;
	}
});
