import { test } from "node:test";
import assert from "node:assert/strict";
import { mcUploadBody } from "../extension/lib/adapters/obsidian.js";
import {
	notionCapsFromBotUser, notionPageProperties,
	NOTION_PROPS, mapDataSourceResults, notionAdapter,
} from "../extension/lib/adapters/notion.js";

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

test("NOTION_PROPS is the single source of truth used by notionPageProperties", () => {
	const props = notionPageProperties(
		{ filename: "a.png", sourceTitle: "T", sourceUrl: "https://a.com", capturedAt: 0 },
		"up-1"
	);
	for (const name of Object.values(NOTION_PROPS)) {
		assert.ok(name in props, `page properties missing ${name}`);
	}
});

test("mapDataSourceResults keeps database-backed sources and flags missing template columns", () => {
	const json = {
		results: [
			{
				object: "data_source", id: "ds1", parent: { database_id: "db1" },
				title: [{ plain_text: "灵感库" }],
				properties: { Name: {}, Image: {}, "Source URL": {}, "Source Title": {}, Captured: {} },
			},
			{
				object: "data_source", id: "ds2", parent: { database_id: "db2" },
				title: [{ plain_text: "别的库" }],
				properties: { Name: {}, Tags: {} }, // 不是模板复制的 → 缺列要点名
			},
			{ object: "page", id: "p1" }, // 页面一律不进列表
			{ object: "data_source", id: "ds3", title: [] }, // 没挂在 database 下 → 丢弃
		],
	};
	assert.deepEqual(mapDataSourceResults(json), [
		{ databaseId: "db1", title: "灵感库", missing: [] },
		{ databaseId: "db2", title: "别的库", missing: ["Image", "Source URL", "Source Title", "Captured"] },
	]);
});
test("mapDataSourceResults trusts sources when the API returns no schema", () => {
	const json = { results: [{ object: "data_source", id: "ds1", parent: { database_id: "db1" }, title: [{ plain_text: "库" }] }] };
	assert.deepEqual(mapDataSourceResults(json), [{ databaseId: "db1", title: "库", missing: [] }]);
});
test("mapDataSourceResults tolerates a malformed response", () => {
	assert.deepEqual(mapDataSourceResults({}), []);
	assert.deepEqual(mapDataSourceResults(null), []);
});

// —— 网络方法用 mock fetch 测。node:test 的 t.after 保证恢复。 ——
function mockFetch(t, handler) {
	const orig = globalThis.fetch;
	globalThis.fetch = handler;
	t.after(() => { globalThis.fetch = orig; });
}

test("notionAdapter.test fails with errNotionToken on 401", async (t) => {
	mockFetch(t, async () => ({ status: 401, ok: false }));
	const r = await notionAdapter.test({ token: "bad", databaseId: "db1" });
	assert.deepEqual(r, { ok: false, errorKey: "errNotionToken" });
});
test("notionAdapter.test fails with errNotionDatabase when the db is not visible", async (t) => {
	// 上次踩的坑:token 对但库没分享给 integration,老实现会假绿灯
	mockFetch(t, async (url) => {
		if (String(url).endsWith("/users/me")) return { status: 200, ok: true, json: async () => ({ bot: {} }) };
		return { status: 404, ok: false };
	});
	const r = await notionAdapter.test({ token: "good", databaseId: "db-unshared" });
	assert.deepEqual(r, { ok: false, errorKey: "errNotionDatabase" });
});
test("notionAdapter.test passes only when token AND database both check out", async (t) => {
	mockFetch(t, async (url) => {
		if (String(url).endsWith("/users/me")) return { status: 200, ok: true, json: async () => ({ bot: {} }) };
		return { status: 200, ok: true, json: async () => ({ id: "db1" }) };
	});
	const r = await notionAdapter.test({ token: "good", databaseId: "db1" });
	assert.equal(r.ok, true);
});

test("notionAdapter.verifyToken needs only a token, no databaseId", async (t) => {
	mockFetch(t, async () => ({ status: 200, ok: true, json: async () => ({ bot: {} }) }));
	const r = await notionAdapter.verifyToken({ token: "good" });
	assert.equal(r.ok, true);
});
test("notionAdapter.verifyToken rejects an empty token without a network call", async (t) => {
	mockFetch(t, async () => { throw new Error("should not fetch"); });
	const r = await notionAdapter.verifyToken({ token: "" });
	assert.deepEqual(r, { ok: false, errorKey: "errNotionToken" });
});

test("notionAdapter.searchDataSources filters by data_source and returns mapped sources", async (t) => {
	let sentBody;
	mockFetch(t, async (url, init) => {
		sentBody = JSON.parse(init.body);
		return {
			status: 200, ok: true,
			json: async () => ({ results: [{ object: "data_source", id: "ds1", parent: { database_id: "db1" }, title: [{ plain_text: "灵感库" }] }] }),
		};
	});
	const r = await notionAdapter.searchDataSources({ token: "good" });
	assert.deepEqual(r, { ok: true, sources: [{ databaseId: "db1", title: "灵感库", missing: [] }] });
	assert.deepEqual(sentBody.filter, { value: "data_source", property: "object" });
});
test("notionAdapter.searchDataSources flags an empty result as errNotionSearchEmpty", async (t) => {
	mockFetch(t, async () => ({ status: 200, ok: true, json: async () => ({ results: [] }) }));
	const r = await notionAdapter.searchDataSources({ token: "good" });
	assert.deepEqual(r, { ok: false, errorKey: "errNotionSearchEmpty" });
});
