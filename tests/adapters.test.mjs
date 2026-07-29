import { test } from "node:test";
import assert from "node:assert/strict";
import { mcUploadBody } from "../extension/lib/adapters/obsidian.js";

test("mcUploadBody maps a CaptureItem onto the Media Companion upload schema", () => {
	const body = mcUploadBody(
		{ base64: "QUJD", filename: "NiceArt-5.gif", sourceUrl: "https://x.com/p", sourceTitle: "NiceArt" },
		"灵感库"
	);
	assert.deepEqual(body, {
		imageBase64: "QUJD",
		filename: "NiceArt-5.gif",
		folder: "灵感库",
		tags: [],
		sourceUrl: "https://x.com/p",
		sourceTitle: "NiceArt",
	});
});
test("mcUploadBody never invents tags at capture time", () => {
	// spec 使用约定：捕获时一律不打标，交给后置的手动/AI 流程
	const body = mcUploadBody({ base64: "A", filename: "x.png", sourceUrl: "", sourceTitle: "clip" }, "F");
	assert.deepEqual(body.tags, []);
});
test("mcUploadBody passes the empty sourceUrl through rather than dropping the key", () => {
	// MC 侧的 sidecar 生成期望字段齐全；缺 key 与空串在它那边不是一回事
	const body = mcUploadBody({ base64: "A", filename: "x.png", sourceUrl: "", sourceTitle: "t" }, "F");
	assert.ok("sourceUrl" in body);
	assert.equal(body.sourceUrl, "");
});
