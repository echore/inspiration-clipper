import { test } from "node:test";
import assert from "node:assert/strict";
import { withDefaults } from "../extension/lib/settings.js";

test("withDefaults supplies an empty chain and per-adapter defaults", () => {
	const s = withDefaults(undefined);
	assert.deepEqual(s.chain, []);
	assert.equal(s.byAdapter.obsidian.port, 27124);
	assert.equal(s.byAdapter.obsidian.folder, "灵感库");
	assert.equal(s.byAdapter.obsidian.apiKey, "");
});
test("withDefaults preserves stored values over defaults", () => {
	const s = withDefaults({ chain: ["obsidian"], byAdapter: { obsidian: { port: 9999 } } });
	assert.deepEqual(s.chain, ["obsidian"]);
	assert.equal(s.byAdapter.obsidian.port, 9999);
	assert.equal(s.byAdapter.obsidian.folder, "灵感库");
});
