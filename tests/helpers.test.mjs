import { test } from "node:test";
import assert from "node:assert/strict";
import {
	sanitizeTitle,
	buildFilename,
	extFromContentType,
	extFromUrl,
	pickExt,
	byteLengthFromBase64,
} from "../extension/lib/helpers.js";

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
test("extFromContentType maps known types and strips params", () => {
	assert.equal(extFromContentType("image/gif"), "gif");
	assert.equal(extFromContentType("video/mp4; codecs=avc1"), "mp4");
	assert.equal(extFromContentType("video/quicktime"), "mov");
	assert.equal(extFromContentType("image/svg+xml"), "svg");
	assert.equal(extFromContentType("text/html"), null);
	assert.equal(extFromContentType(null), null);
});
test("extFromUrl reads the pathname extension only", () => {
	assert.equal(extFromUrl("https://a.com/x/anim.gif?x=1"), "gif");
	assert.equal(extFromUrl("https://pbs.twimg.com/media/abc?format=jpg&name=large"), null);
	assert.equal(extFromUrl("https://a.com/clip.mp4"), "mp4");
	assert.equal(extFromUrl("https://a.com/logo.svg"), "svg");
	assert.equal(extFromUrl("not a url"), null);
});
test("pickExt prefers content-type, falls back to url, then null (never a fake ext)", () => {
	assert.equal(pickExt("image/gif", "https://a.com/x.mp4"), "gif");
	assert.equal(pickExt(null, "https://a.com/x.webm"), "webm");
	assert.equal(pickExt("image/svg+xml", "https://a.com/x"), "svg");
	assert.equal(pickExt("application/octet-stream", "https://a.com/x"), null);
});
test("buildFilename honors ext parameter and defaults to png", () => {
	assert.equal(buildFilename("T", 5, "gif"), "T-5.gif");
	assert.equal(buildFilename("T", 5), "T-5.png");
});
test("byteLengthFromBase64 computes exact decoded size", () => {
	// "A" -> "QQ==", "AB" -> "QUI=", "ABC" -> "QUJD"
	assert.equal(byteLengthFromBase64("QQ=="), 1);
	assert.equal(byteLengthFromBase64("QUI="), 2);
	assert.equal(byteLengthFromBase64("QUJD"), 3);
	assert.equal(byteLengthFromBase64(""), 0);
});
test("byteLengthFromBase64 handles a 4KB payload without padding drift", () => {
	const b64 = "A".repeat(5464); // 5464 chars, no padding -> 4098 bytes
	assert.equal(byteLengthFromBase64(b64), 4098);
});
