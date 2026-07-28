import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTitle, buildFilename, buildUploadBody, friendlyError } from "../extension/lib/helpers.js";

test("sanitizeTitle strips forbidden chars and trims", () => {
	assert.equal(sanitizeTitle('  a/b\\c:d*e?f"g<h>i|j#k[l]  '), "abcdefghijkl");
});
test("sanitizeTitle caps at 60 chars", () => {
	assert.equal(sanitizeTitle("x".repeat(80)).length, 60);
});
test("sanitizeTitle falls back to clip when empty", () => {
	assert.equal(sanitizeTitle("///"), "clip");
});
test("buildFilename composes title and timestamp", () => {
	assert.equal(buildFilename("Nice Art", 1722180000000), "Nice Art-1722180000000.png");
});
test("buildUploadBody shapes the API payload", () => {
	const b = buildUploadBody({ imageBase64: "AAA", title: "T", sourceUrl: "https://x.com/p", folder: "灵感库", now: 5 });
	assert.deepEqual(b, { imageBase64: "AAA", filename: "T-5.png", folder: "灵感库", tags: [], sourceUrl: "https://x.com/p", sourceTitle: "T" });
});
test("friendlyError maps network failure to Obsidian-closed message", () => {
	assert.match(friendlyError({ networkError: true }), /Obsidian（creation-flywheel）没开/);
});
test("friendlyError maps 401 to key mismatch message", () => {
	assert.match(friendlyError({ status: 401 }), /钥匙对不上/);
});
test("friendlyError default message", () => {
	assert.match(friendlyError({ status: 500 }), /没存上，重试一下/);
});
