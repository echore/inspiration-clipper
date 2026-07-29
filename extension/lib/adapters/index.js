import { obsidianAdapter } from "./obsidian.js";

export const ADAPTERS = { obsidian: obsidianAdapter };
export function getAdapter(id) {
	return ADAPTERS[id] ?? null;
}
