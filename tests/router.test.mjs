import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseDestination } from "../extension/lib/router.js";

const caps = { notion: { maxFileSize: 5 * 1024 * 1024 }, obsidian: { maxFileSize: Infinity } };

test("picks the first destination when the item fits", () => {
	const r = chooseDestination({ byteLength: 1024 }, ["notion", "obsidian"], caps);
	assert.deepEqual(r, { adapterId: "notion", degradedFrom: null });
});
test("degrades to the next destination when the item exceeds the first", () => {
	const r = chooseDestination({ byteLength: 8 * 1024 * 1024 }, ["notion", "obsidian"], caps);
	assert.deepEqual(r, { adapterId: "obsidian", degradedFrom: "notion" });
});
test("reports the exact boundary as fitting", () => {
	const r = chooseDestination({ byteLength: 5 * 1024 * 1024 }, ["notion"], caps);
	assert.deepEqual(r, { adapterId: "notion", degradedFrom: null });
});
test("errors when nothing in the chain can hold the item", () => {
	const r = chooseDestination({ byteLength: 8 * 1024 * 1024 }, ["notion"], caps);
	assert.deepEqual(r, { error: "tooLargeForAll", byteLength: 8388608, maxFileSize: 5242880 });
});
test("errors on an empty chain", () => {
	assert.deepEqual(chooseDestination({ byteLength: 1 }, [], caps), { error: "noDestination" });
});
test("skips a destination with unknown capabilities rather than guessing", () => {
	const r = chooseDestination({ byteLength: 1 }, ["mystery", "obsidian"], caps);
	assert.deepEqual(r, { adapterId: "obsidian", degradedFrom: "mystery" });
});
test("attempts preferred destination when all have unknown capabilities (lets adapter surface precise error)", () => {
	const r = chooseDestination({ byteLength: 1 }, ["mystery", "unknown"], {});
	assert.deepEqual(r, { adapterId: "mystery", degradedFrom: null });
});
test("guards against null/undefined capsById and attempts chain[0]", () => {
	const r = chooseDestination({ byteLength: 1 }, ["fallback"], null);
	assert.deepEqual(r, { adapterId: "fallback", degradedFrom: null });
	const r2 = chooseDestination({ byteLength: 1 }, ["fallback"], undefined);
	assert.deepEqual(r2, { adapterId: "fallback", degradedFrom: null });
});
