import { obsidianAdapter } from "./obsidian.js";
import { notionAdapter } from "./notion.js";

export const ADAPTERS = { obsidian: obsidianAdapter, notion: notionAdapter };
export function getAdapter(id) {
	return ADAPTERS[id] ?? null;
}
