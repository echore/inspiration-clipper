// extension/lib/settings.js — 配置读写。纯函数 withDefaults 可测；其余是 chrome.storage 薄包装。
import { ADAPTERS } from "./adapters/index.js";

const DEFAULTS = {
	obsidian: { port: 27124, apiKey: "", folder: "灵感库" },
	notion: { token: "", databaseId: "" },
};

export function withDefaults(stored) {
	const s = stored || {};
	const byAdapter = {};
	for (const [id, d] of Object.entries(DEFAULTS)) {
		byAdapter[id] = { ...d, ...((s.byAdapter || {})[id] || {}) };
	}
	return { chain: s.chain || [], byAdapter };
}

export async function loadSettings() {
	const { settings } = await chrome.storage.local.get("settings");
	return withDefaults(settings);
}

export async function saveSettings(next) {
	await chrome.storage.local.set({ settings: next });
}

export async function probeAll() {
	const s = await loadSettings();
	const caps = {};
	for (const id of s.chain) {
		const a = ADAPTERS[id];
		if (!a) continue;
		const r = await a.test(s.byAdapter[id]);
		if (r.ok) caps[id] = r.capabilities ?? a.capabilities(s.byAdapter[id]);
	}
	return caps;
}
