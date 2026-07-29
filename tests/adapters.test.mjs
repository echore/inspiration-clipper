import { test } from "node:test";
import assert from "node:assert/strict";
import { mcUploadBody } from "../extension/lib/adapters/obsidian.js";
import { notionCapsFromBotUser, notionPageProperties } from "../extension/lib/adapters/notion.js";

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

test("notionCapsFromBotUser reads the workspace upload ceiling", () => {
	const caps = notionCapsFromBotUser({ bot: { workspace_limits: { max_file_upload_size_in_bytes: 5242880 } } });
	assert.deepEqual(caps, { maxFileSize: 5242880 });
});
test("notionCapsFromBotUser falls back to the free-tier ceiling when absent", () => {
	// 保守取小值：宁可误降级到 Obsidian，也不要传上去才失败
	assert.deepEqual(notionCapsFromBotUser({ bot: {} }), { maxFileSize: 5242880 });
	assert.deepEqual(notionCapsFromBotUser({}), { maxFileSize: 5242880 });
});
test("notionPageProperties maps a CaptureItem onto the template schema", () => {
	const props = notionPageProperties({
		filename: "x-5.gif", sourceTitle: "T", sourceUrl: "https://a.com/p", capturedAt: 0,
	}, "upload-123");
	assert.deepEqual(props.Name, { title: [{ text: { content: "x-5.gif" } }] });
	assert.deepEqual(props["Source URL"], { url: "https://a.com/p" });
	assert.deepEqual(props["Source Title"], { rich_text: [{ text: { content: "T" } }] });
	assert.equal(props.Captured.date.start, "1970-01-01T00:00:00.000Z");
	assert.deepEqual(props.Image.files, [
		{ type: "file_upload", file_upload: { id: "upload-123" }, name: "x-5.gif" },
	]);
	assert.equal(props.Image.type, "files");
});
test("notionPageProperties omits an empty source url rather than sending an empty string", () => {
	const props = notionPageProperties({ filename: "x.png", sourceTitle: "T", sourceUrl: "", capturedAt: 0 }, "u");
	assert.deepEqual(props["Source URL"], { url: null });
});
