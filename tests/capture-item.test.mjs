import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCaptureItem } from "../extension/lib/capture-item.js";

test("makeCaptureItem assembles filename, sourceTitle and byteLength", () => {
	const item = makeCaptureItem({
		base64: "QUJD",
		ext: "gif",
		mime: "image/gif",
		title: "Nice/Art",
		sourceUrl: "https://x.com/p",
		now: 1722180000000,
	});
	assert.equal(item.filename, "NiceArt-1722180000000.gif");
	assert.equal(item.sourceTitle, "NiceArt");
	assert.equal(item.byteLength, 3);
	assert.equal(item.capturedAt, 1722180000000);
	assert.equal(item.mime, "image/gif");
});
test("makeCaptureItem falls back to clip for an unusable title", () => {
	const item = makeCaptureItem({ base64: "QQ==", ext: "png", mime: "image/png", title: "///", sourceUrl: "", now: 5 });
	assert.equal(item.filename, "clip-5.png");
	assert.equal(item.sourceTitle, "clip");
});
