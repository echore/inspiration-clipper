// extension/lib/onboarding.js — 向导的纯函数层。不碰 DOM、不碰 chrome API,
// 让步骤流转和输入清洗可以在 node 里直接测。

// "choose" 和 "done" 是所有分支共享的首尾,不进流程表。
// Notion 只有两步:库来自用户自己复制的模板,扩展不代建。
const FLOWS = {
	obsidian: ["obsidian-install", "obsidian-connect", "obsidian-folder"],
	notion: ["notion-token", "notion-connect"],
};

// 剥尖括号:真实发生过的复制损坏——用户把指引里的占位符符号一起粘进来。
export function sanitizeToken(raw) {
	return String(raw ?? "")
		.trim()
		.replace(/^<+/, "")
		.replace(/>+$/, "")
		.trim();
}

export function flowFor(dest) {
	return FLOWS[dest] ?? [];
}

export function nextStep(dest, current) {
	const flow = flowFor(dest);
	if (current === "choose") return flow[0] ?? null;
	const i = flow.indexOf(current);
	if (i === -1) return null;
	return i === flow.length - 1 ? "done" : flow[i + 1];
}

export function prevStep(dest, current) {
	const flow = flowFor(dest);
	const i = flow.indexOf(current);
	if (i === -1) return null;
	return i === 0 ? "choose" : flow[i - 1];
}

// 总览页"重新配置"的落点:跳过 Obsidian 的装插件步(老用户已装好)。
export function firstCredentialStep(dest) {
	return dest === "obsidian" ? "obsidian-connect" : "notion-token";
}

export function stepNumber(dest, current) {
	return flowFor(dest).indexOf(current) + 1;
}
