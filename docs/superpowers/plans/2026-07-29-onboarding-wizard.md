# Onboarding 向导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 options 页重构为分步配置向导(一页两态),首装自动打开,Notion 自动建库,让零基础用户不看文档配通任一目的地。

**Architecture:** 向导逻辑(步骤流转、token 清洗、请求体构造)全部下沉为 `lib/` 纯函数,options.js 只做 DOM 布线;Notion adapter 新增 `verifyToken/searchPages/createDatabase` 三个方法并增强 `test()`;settings 数据结构零改动。

**Tech Stack:** Chrome MV3(ES modules)、`node --test` 裸跑(无 package.json)、`chrome.i18n` + `_locales`、Notion API 版本 `2026-03-11`(建库 schema 在 `initial_data_source.properties` 下,已对官方文档查证)。

**Spec:** `docs/superpowers/specs/2026-07-29-onboarding-redesign-design.md`

## Global Constraints

- 测试命令固定为 `node --test 'tests/*.test.mjs'`(glob;**node --test 不认目录参数**)。仓库无 package.json,不要引入。
- 缩进用 **tab**,注释风格随现有文件(中文、讲"为什么")。
- 中文文案零术语、人话;**任何文案不得出现尖括号占位符**(实际发生过复制损坏事故)。
- 全部新文案必须同时写入 `_locales/en/messages.json` 和 `_locales/zh_CN/messages.json`。
- 不改 `lib/settings.js`、`lib/router.js`、adapter 的 `save()`、popup。
- Notion 属性名五件套以 `NOTION_PROPS` 常量为单一事实来源:`Name` / `Image` / `Source URL` / `Source Title` / `Captured`。
- Media Companion fork 下载地址:`https://github.com/echore/obsidian-media-companion/releases/latest`。
- 每个 Task 结束必须全量跑测试并 commit。

---

### Task 1: `lib/onboarding.js` — 向导纯函数(token 清洗 + 步骤流转)

**Files:**
- Create: `extension/lib/onboarding.js`
- Test: `tests/onboarding.test.mjs`

**Interfaces:**
- Consumes: 无(叶子模块,不 import 任何东西)
- Produces:
  - `sanitizeToken(raw: unknown): string` — trim + 剥掉首尾尖括号
  - `flowFor(dest: string): string[]` — 分支步骤序列(不含 choose/done)
  - `nextStep(dest: string, current: string): string | null`
  - `prevStep(dest: string, current: string): string | null`
  - `firstCredentialStep(dest: string): string` — 总览"重新配置"的落点
  - `stepNumber(dest: string, current: string): number` — 1 起;不在流程内返回 0

- [ ] **Step 1: 写失败测试** `tests/onboarding.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	sanitizeToken, flowFor, nextStep, prevStep, firstCredentialStep, stepNumber,
} from "../extension/lib/onboarding.js";

test("sanitizeToken passes a clean token through", () => {
	assert.equal(sanitizeToken("ntn_abc123"), "ntn_abc123");
});
test("sanitizeToken strips whitespace and wrapping angle brackets", () => {
	// 实际事故:用户从带占位符的指引里复制,token 被 <> 包住
	assert.equal(sanitizeToken("  <ntn_abc123>  "), "ntn_abc123");
	assert.equal(sanitizeToken("<<ntn_x>>"), "ntn_x");
	assert.equal(sanitizeToken("\tntn_y\n"), "ntn_y");
});
test("sanitizeToken tolerates non-string input", () => {
	assert.equal(sanitizeToken(null), "");
	assert.equal(sanitizeToken(undefined), "");
});

test("flowFor returns the 3-step branch for each destination", () => {
	assert.deepEqual(flowFor("obsidian"), ["obsidian-install", "obsidian-connect", "obsidian-folder"]);
	assert.deepEqual(flowFor("notion"), ["notion-token", "notion-page", "notion-database"]);
	assert.deepEqual(flowFor(""), []);
});

test("nextStep walks choose → branch → done", () => {
	assert.equal(nextStep("obsidian", "choose"), "obsidian-install");
	assert.equal(nextStep("obsidian", "obsidian-install"), "obsidian-connect");
	assert.equal(nextStep("obsidian", "obsidian-folder"), "done");
	assert.equal(nextStep("notion", "choose"), "notion-token");
	assert.equal(nextStep("notion", "notion-database"), "done");
	assert.equal(nextStep("notion", "not-a-step"), null);
});

test("prevStep walks branch → choose and never past it", () => {
	assert.equal(prevStep("obsidian", "obsidian-install"), "choose");
	assert.equal(prevStep("notion", "notion-page"), "notion-token");
	assert.equal(prevStep("notion", "not-a-step"), null);
});

test("firstCredentialStep skips the install step for reconfiguration", () => {
	// 老用户重新配置不需要再看"装插件"
	assert.equal(firstCredentialStep("obsidian"), "obsidian-connect");
	assert.equal(firstCredentialStep("notion"), "notion-token");
});

test("stepNumber is 1-based within the branch, 0 outside it", () => {
	assert.equal(stepNumber("obsidian", "obsidian-install"), 1);
	assert.equal(stepNumber("obsidian", "obsidian-folder"), 3);
	assert.equal(stepNumber("notion", "choose"), 0);
	assert.equal(stepNumber("notion", "done"), 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test 'tests/onboarding.test.mjs'`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 写实现** `extension/lib/onboarding.js`

```js
// extension/lib/onboarding.js — 向导的纯函数层。不碰 DOM、不碰 chrome API,
// 让步骤流转和输入清洗可以在 node 里直接测。

// 每个分支 3 步;"choose" 和 "done" 是所有分支共享的首尾,不进流程表。
const FLOWS = {
	obsidian: ["obsidian-install", "obsidian-connect", "obsidian-folder"],
	notion: ["notion-token", "notion-page", "notion-database"],
};

// 剥尖括号:真实发生过的复制损坏——用户把指引里的占位符符号一起粘进来。
export function sanitizeToken(raw) {
	return String(raw ?? "")
		.trim()
		.replace(/^<+/, "")
		.replace(/>+$/, "")
		.trim();
}

export function flowFor(dest) {
	return FLOWS[dest] ?? [];
}

export function nextStep(dest, current) {
	const flow = flowFor(dest);
	if (current === "choose") return flow[0] ?? null;
	const i = flow.indexOf(current);
	if (i === -1) return null;
	return i === flow.length - 1 ? "done" : flow[i + 1];
}

export function prevStep(dest, current) {
	const flow = flowFor(dest);
	const i = flow.indexOf(current);
	if (i === -1) return null;
	return i === 0 ? "choose" : flow[i - 1];
}

// 总览页"重新配置"的落点:跳过 Obsidian 的装插件步(老用户已装好)。
export function firstCredentialStep(dest) {
	return dest === "obsidian" ? "obsidian-connect" : "notion-token";
}

export function stepNumber(dest, current) {
	return flowFor(dest).indexOf(current) + 1;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test 'tests/*.test.mjs'`
Expected: 全绿(新增 + 既有)

- [ ] **Step 5: Commit**

```bash
git add extension/lib/onboarding.js tests/onboarding.test.mjs
git commit -m "feat: onboarding pure helpers — token sanitize + wizard step flow"
```

---

### Task 2: Notion adapter — 属性常量、建库、搜页面、test 增强

**Files:**
- Modify: `extension/lib/adapters/notion.js`
- Test: `tests/adapters.test.mjs`(追加,既有用例必须保持通过)

**Interfaces:**
- Consumes: 无新依赖
- Produces(全部挂在 `notionAdapter` 上或具名导出):
  - `NOTION_PROPS: { name, image, sourceUrl, sourceTitle, captured }` — 属性名常量
  - `createDatabasePayload(parentPageId: string, title: string): object`
  - `mapSearchResults(json: object): Array<{ id: string, title: string }>`
  - `notionAdapter.verifyToken(cfg): Promise<{ ok, errorKey? }>` — 只验 token(N1 用,不需要 databaseId)
  - `notionAdapter.searchPages(cfg): Promise<{ ok, pages?, errorKey? }>`
  - `notionAdapter.createDatabase(cfg, parentPageId: string, title: string): Promise<{ ok, databaseId?, errorKey? }>`
  - `notionAdapter.test(cfg)` 增强:token 通过后再 `GET /v1/databases/{id}`,失败返回 `errNotionDatabase`

- [ ] **Step 1: 追加失败测试到 `tests/adapters.test.mjs`**

在文件顶部 import 行补上新导出:

```js
import {
	notionCapsFromBotUser, notionPageProperties,
	NOTION_PROPS, createDatabasePayload, mapSearchResults, notionAdapter,
} from "../extension/lib/adapters/notion.js";
```

文件末尾追加:

```js
test("NOTION_PROPS is the single source of truth used by notionPageProperties", () => {
	const props = notionPageProperties(
		{ filename: "a.png", sourceTitle: "T", sourceUrl: "https://a.com", capturedAt: 0 },
		"up-1"
	);
	for (const name of Object.values(NOTION_PROPS)) {
		assert.ok(name in props, `page properties missing ${name}`);
	}
});

test("createDatabasePayload nests the 5-property schema under initial_data_source (2025-09+ API shape)", () => {
	const p = createDatabasePayload("page-123", "灵感库");
	assert.deepEqual(p.parent, { type: "page_id", page_id: "page-123" });
	assert.deepEqual(p.title, [{ type: "text", text: { content: "灵感库" } }]);
	const schema = p.initial_data_source.properties;
	assert.deepEqual(schema[NOTION_PROPS.name], { title: {} });
	assert.deepEqual(schema[NOTION_PROPS.image], { files: {} });
	assert.deepEqual(schema[NOTION_PROPS.sourceUrl], { url: {} });
	assert.deepEqual(schema[NOTION_PROPS.sourceTitle], { rich_text: {} });
	assert.deepEqual(schema[NOTION_PROPS.captured], { date: {} });
	assert.equal(Object.keys(schema).length, 5);
});

test("mapSearchResults keeps pages only and extracts the title property", () => {
	const json = {
		results: [
			{ object: "page", id: "p1", properties: { title: { type: "title", title: [{ plain_text: "灵感" }, { plain_text: "收集" }] } } },
			{ object: "database", id: "d1" },
			{ object: "page", id: "p2", properties: {} }, // 无标题页面 → title 为空串,UI 层兜底
		],
	};
	assert.deepEqual(mapSearchResults(json), [
		{ id: "p1", title: "灵感收集" },
		{ id: "p2", title: "" },
	]);
});
test("mapSearchResults tolerates a malformed response", () => {
	assert.deepEqual(mapSearchResults({}), []);
	assert.deepEqual(mapSearchResults(null), []);
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

test("notionAdapter.searchPages returns mapped pages", async (t) => {
	mockFetch(t, async () => ({
		status: 200, ok: true,
		json: async () => ({ results: [{ object: "page", id: "p1", properties: { N: { type: "title", title: [{ plain_text: "Home" }] } } }] }),
	}));
	const r = await notionAdapter.searchPages({ token: "good" });
	assert.deepEqual(r, { ok: true, pages: [{ id: "p1", title: "Home" }] });
});
test("notionAdapter.searchPages flags an empty result as errNotionSearchEmpty", async (t) => {
	mockFetch(t, async () => ({ status: 200, ok: true, json: async () => ({ results: [] }) }));
	const r = await notionAdapter.searchPages({ token: "good" });
	assert.deepEqual(r, { ok: false, errorKey: "errNotionSearchEmpty" });
});

test("notionAdapter.createDatabase returns the new databaseId", async (t) => {
	let sentBody;
	mockFetch(t, async (url, init) => {
		sentBody = JSON.parse(init.body);
		return { status: 200, ok: true, json: async () => ({ id: "new-db-id" }) };
	});
	const r = await notionAdapter.createDatabase({ token: "good" }, "page-1", "灵感库");
	assert.deepEqual(r, { ok: true, databaseId: "new-db-id" });
	assert.equal(sentBody.parent.page_id, "page-1");
});
test("notionAdapter.createDatabase maps failure to errNotionCreateDb", async (t) => {
	mockFetch(t, async () => ({ status: 400, ok: false }));
	const r = await notionAdapter.createDatabase({ token: "good" }, "page-1", "灵感库");
	assert.deepEqual(r, { ok: false, errorKey: "errNotionCreateDb" });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test 'tests/adapters.test.mjs'`
Expected: FAIL(新导出不存在);既有用例仍应通过

- [ ] **Step 3: 改 `extension/lib/adapters/notion.js`**

3a. 文件顶部(`const API` 之后)加常量,并把 `notionPageProperties` 里的字符串字面量换成常量引用:

```js
// 属性名五件套:建库 schema 和写入条目共用,改一处两边同步。
export const NOTION_PROPS = {
	name: "Name",
	image: "Image",
	sourceUrl: "Source URL",
	sourceTitle: "Source Title",
	captured: "Captured",
};
```

```js
export function notionPageProperties(item, fileUploadId) {
	return {
		[NOTION_PROPS.name]: { title: [{ text: { content: item.filename } }] },
		[NOTION_PROPS.image]: { type: "files", files: [{ type: "file_upload", file_upload: { id: fileUploadId }, name: item.filename }] },
		[NOTION_PROPS.sourceUrl]: { url: item.sourceUrl || null },
		[NOTION_PROPS.sourceTitle]: { rich_text: [{ text: { content: item.sourceTitle } }] },
		[NOTION_PROPS.captured]: { date: { start: new Date(item.capturedAt).toISOString() } },
	};
}
```

3b. 加两个纯函数(`notionPageProperties` 之后):

```js
// 建库请求体。API 版本 2025-09-03 起 schema 必须嵌在 initial_data_source 下
// (数据库变成了数据源的容器),顶层 properties 会被拒。
export function createDatabasePayload(parentPageId, title) {
	return {
		parent: { type: "page_id", page_id: parentPageId },
		title: [{ type: "text", text: { content: title } }],
		initial_data_source: {
			properties: {
				[NOTION_PROPS.name]: { title: {} },
				[NOTION_PROPS.image]: { files: {} },
				[NOTION_PROPS.sourceUrl]: { url: {} },
				[NOTION_PROPS.sourceTitle]: { rich_text: {} },
				[NOTION_PROPS.captured]: { date: {} },
			},
		},
	};
}

// search 结果 → { id, title } 列表。title 属性的键名随页面模板变,按 type 找。
export function mapSearchResults(json) {
	const results = Array.isArray(json?.results) ? json.results : [];
	return results
		.filter((r) => r?.object === "page")
		.map((r) => {
			let title = "";
			for (const prop of Object.values(r.properties ?? {})) {
				if (prop?.type === "title") {
					title = (prop.title ?? []).map((seg) => seg?.plain_text ?? "").join("");
					break;
				}
			}
			return { id: r.id, title };
		});
}
```

3c. `notionAdapter` 对象:重写 `test`,新增 `verifyToken` / `searchPages` / `createDatabase`(`save` 不动):

```js
	async verifyToken(cfg) {
		// 向导 N1 用:此时还没有 databaseId,只验钥匙本身
		if (!cfg?.token) return { ok: false, errorKey: "errNotionToken" };
		try {
			const res = await fetch(`${API}/users/me`, { headers: headers(cfg) });
			if (res.status === 401) return { ok: false, errorKey: "errNotionToken" };
			if (!res.ok) return { ok: false, errorKey: "errNotionGeneric" };
			cachedCaps = notionCapsFromBotUser(await res.json());
			return { ok: true };
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
	},

	async test(cfg) {
		if (!cfg.token || !cfg.databaseId) return { ok: false, errorKey: "errNotionUnconfigured" };
		const tokenCheck = await this.verifyToken(cfg);
		if (!tokenCheck.ok) return tokenCheck;
		// 第二段:库真的可见吗?token 对但库没分享给 integration 时,
		// 老实现会假绿灯,存的时候才炸——这里就拦住。
		try {
			const res = await fetch(`${API}/databases/${cfg.databaseId}`, { headers: headers(cfg) });
			if (!res.ok) return { ok: false, errorKey: "errNotionDatabase" };
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
		return { ok: true, capabilities: cachedCaps };
	},

	async searchPages(cfg) {
		try {
			const res = await fetch(`${API}/search`, {
				method: "POST",
				headers: { ...headers(cfg), "Content-Type": "application/json" },
				body: JSON.stringify({ filter: { value: "page", property: "object" }, page_size: 20 }),
			});
			if (res.status === 401) return { ok: false, errorKey: "errNotionToken" };
			if (!res.ok) return { ok: false, errorKey: "errNotionGeneric" };
			const pages = mapSearchResults(await res.json());
			if (pages.length === 0) return { ok: false, errorKey: "errNotionSearchEmpty" };
			return { ok: true, pages };
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
	},

	async createDatabase(cfg, parentPageId, title) {
		let res;
		try {
			res = await fetch(`${API}/databases`, {
				method: "POST",
				headers: { ...headers(cfg), "Content-Type": "application/json" },
				body: JSON.stringify(createDatabasePayload(parentPageId, title)),
			});
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
		if (!res.ok) return { ok: false, errorKey: "errNotionCreateDb" };
		const json = await res.json();
		return { ok: true, databaseId: json.id };
	},
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test 'tests/*.test.mjs'`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add extension/lib/adapters/notion.js tests/adapters.test.mjs
git commit -m "feat: notion adapter — verifyToken/searchPages/createDatabase + two-stage test"
```

---

### Task 3: i18n 全部向导文案(中英)

**Files:**
- Modify: `extension/_locales/zh_CN/messages.json`
- Modify: `extension/_locales/en/messages.json`

**Interfaces:**
- Consumes: 无
- Produces: 下列全部 message key,Task 4 的 HTML/JS 按这些 key 取文案

- [ ] **Step 1: 在 `zh_CN/messages.json` 追加以下 key**(JSON 格式 `"key": { "message": "..." }`,保持文件现有排版):

```
wizChooseTitle        你想把灵感存到哪里?
wizChooseObsidian     存到你电脑本地的 Obsidian 笔记库(需要先装一个插件)
wizChooseNotion       存到云端的 Notion 数据库(需要 Notion 账号,免费版就行)
wizBack               上一步
wizNext               下一步
wizFinish             完成
wizStepOf             第 $1$ 步,共 3 步
wizObInstallTitle     第一步:给 Obsidian 装上插件
wizObInstallIntro     这个插件负责接收扩展发来的图片。跟着下面三步装好它:
wizObInstallStep1     点下面的按钮,下载最新的插件压缩包(zip 文件)并解压
wizObInstallStep2     把解压出来的整个文件夹,放进你笔记库里的 .obsidian/plugins 文件夹(找不到?在 Obsidian 的 设置 → 第三方插件 里点"打开插件文件夹"就是它)
wizObInstallStep3     回到 Obsidian:设置 → 第三方插件,找到 Media Companion,把开关打开
wizObInstallDownload  下载插件
wizObInstallDone      我装好了,下一步
wizObConnectTitle     第二步:让扩展连上 Obsidian
wizObConnectStep1     在 Obsidian 里打开:设置 → Media Companion
wizObConnectStep2     找到 Local API,把开关打开
wizObConnectStep3     复制页面上显示的 API key,粘到下面的框里
wizObKeyLabel         API key
wizObAdvanced         高级选项(一般不用动)
wizObTestHint         粘好后点"测试连接",连上了才能继续
wizObFolderTitle      最后一步:存到哪个文件夹
wizObFolderHint       图片会存进笔记库里的这个文件夹,不存在会自动创建。不想改就直接点"完成"。
wizNoTokenTitle       第一步:创建一把 Notion 钥匙
wizNoTokenIntro       Notion 要求先创建一个 integration(相当于一把钥匙),扩展才有权限帮你存东西。
wizNoTokenStep1       点下面的按钮,打开 Notion 的 integration 管理页(可能要先登录)
wizNoTokenStep2       点 New integration 新建一个,名字随便起,比如"灵感库"
wizNoTokenStep3       建好后,复制页面上那串 Internal Integration Secret,粘到下面的框里
wizNoTokenOpen        打开 Notion integration 页面
wizNoTokenLabel       Integration Secret
wizNoTokenVerify      验证
wizNoTokenOk          钥匙有效
wizNoPageTitle        第二步:把一个页面交给它管
wizNoPageIntro        在 Notion 里挑一个页面(哪个都行,新建一个也行),把它分享给你刚创建的 integration。灵感库会建在这个页面下面。
wizNoPageStep1        在 Notion 里打开那个页面
wizNoPageStep2        点右上角的 ⋯ 菜单,选"连接"(Connections)
wizNoPageStep3        在列表里找到你刚创建的 integration,点它完成连接
wizNoPageListHint     完成后点"刷新列表",在下面选中那个页面:
wizNoPageRefresh      刷新列表
wizNoDbTitle          第三步:创建灵感库
wizNoDbIntro          点一下按钮,扩展会在你选的页面下自动建好数据库,所有列都配好,不用你动手。
wizNoDbCreate         帮我建库
wizNoDbExisting       检测到你之前建的库还能用,直接沿用它,点"完成"即可
wizNoDbOk             建好了,连接测试也通过了
wizDoneTitle          配置完成,去试试!
wizDoneShortcut       框选截图:在任意网页按 Alt+Shift+S,拖一个框
wizDoneContext        存整张图:右键任意图片,选"存入灵感库"
wizDonePopup          也可以点浏览器右上角的扩展图标
wizDoneTry            现在就打开一个普通网页试一试吧(浏览器自己的设置页和空白新标签页截不了)
ovTitle               当前配置
ovDest                灵感存到:$1$
ovChecking            正在检查连接…
ovFolderLine          文件夹:$1$
ovOpenDb              在 Notion 里查看数据库
ovReconfigure         重新配置
ovSwitchDest          换个地方存
ovUsage               用法:网页上按 Alt+Shift+S 框选;或右键图片,选"存入灵感库"
optUntitledPage       (无标题页面)
errNotionDatabase     找不到数据库:确认它没被删,而且所在页面还连接着你的 integration
errNotionSearchEmpty  还没检测到任何页面。确认你在 Notion 里完成了"连接"这一步,再点刷新列表
errNotionCreateDb     建库没成功,点按钮再试一次
```

带 `$1$` 的 key 需要 placeholders 声明,照抄现有 `okSaved` 的写法,例如:

```json
"wizStepOf": {
	"message": "第 $STEP$ 步,共 3 步",
	"placeholders": { "step": { "content": "$1" } }
},
"ovDest": {
	"message": "灵感存到:$DEST$",
	"placeholders": { "dest": { "content": "$1" } }
},
"ovFolderLine": {
	"message": "文件夹:$FOLDER$",
	"placeholders": { "folder": { "content": "$1" } }
}
```

- [ ] **Step 2: 在 `en/messages.json` 追加同一批 key 的英文版**(逐 key 对应,英文口吻同样零术语。示例给全,实现时逐条写入):

```
wizChooseTitle        Where should your clips go?
wizChooseObsidian     Save into your local Obsidian vault (needs a plugin installed first)
wizChooseNotion       Save into a Notion database in the cloud (free plan works)
wizBack               Back
wizNext               Next
wizFinish             Finish
wizStepOf             Step $1$ of 3
wizObInstallTitle     Step 1: Install the Obsidian plugin
wizObInstallIntro     This plugin receives the images the extension sends. Three steps:
wizObInstallStep1     Click the button below to download the latest plugin zip, then unzip it
wizObInstallStep2     Move the unzipped folder into the .obsidian/plugins folder inside your vault (can't find it? In Obsidian: Settings → Community plugins → "Open plugins folder")
wizObInstallStep3     Back in Obsidian: Settings → Community plugins, find Media Companion and toggle it on
wizObInstallDownload  Download plugin
wizObInstallDone      Installed, next
wizObConnectTitle     Step 2: Connect the extension to Obsidian
wizObConnectStep1     In Obsidian, open: Settings → Media Companion
wizObConnectStep2     Find Local API and toggle it on
wizObConnectStep3     Copy the API key shown there and paste it below
wizObKeyLabel         API key
wizObAdvanced         Advanced (usually no need to touch)
wizObTestHint         After pasting, click "Test connection" — you can continue once it turns green
wizObFolderTitle      Last step: pick a folder
wizObFolderHint       Clips are saved into this folder in your vault; it's created automatically if missing. Just hit "Finish" if the default is fine.
wizNoTokenTitle       Step 1: Create a Notion key
wizNoTokenIntro       Notion requires an "integration" (think of it as a key) before the extension may save anything for you.
wizNoTokenStep1       Click the button below to open Notion's integration page (you may need to log in)
wizNoTokenStep2       Click "New integration", name it anything, e.g. "Inspiration"
wizNoTokenStep3       Copy the Internal Integration Secret it shows and paste it below
wizNoTokenOpen        Open Notion integrations page
wizNoTokenLabel       Integration Secret
wizNoTokenVerify      Verify
wizNoTokenOk          Key works
wizNoPageTitle        Step 2: Hand it a page
wizNoPageIntro        Pick any page in Notion (or create a new one) and share it with the integration you just made. Your library will live under that page.
wizNoPageStep1        Open that page in Notion
wizNoPageStep2        Click the ⋯ menu in the top-right, choose "Connections"
wizNoPageStep3        Find your integration in the list and click it to connect
wizNoPageListHint     Then click "Refresh list" and select the page below:
wizNoPageRefresh      Refresh list
wizNoDbTitle          Step 3: Create the library
wizNoDbIntro          One click — the extension creates the database under your chosen page with every column set up for you.
wizNoDbCreate         Create it for me
wizNoDbExisting       Found your previous database and it still works — just hit "Finish" to keep using it
wizNoDbOk             Created, and the connection test passed
wizDoneTitle          All set — try it out!
wizDoneShortcut       Region screenshot: press Alt+Shift+S on any page and drag a box
wizDoneContext        Save a full image: right-click any image and choose "Save to library"
wizDonePopup          You can also click the extension icon in the toolbar
wizDoneTry            Open a normal webpage and give it a go (the browser's own settings pages and the blank new-tab page can't be captured)
ovTitle               Current setup
ovDest                Saving to: $1$
ovChecking            Checking connection…
ovFolderLine          Folder: $1$
ovOpenDb              Open the database in Notion
ovReconfigure         Reconfigure
ovSwitchDest          Switch destination
ovUsage               Usage: press Alt+Shift+S to clip a region, or right-click an image → "Save to library"
optUntitledPage       (untitled page)
errNotionDatabase     Can't find the database: make sure it wasn't deleted and its page is still connected to your integration
errNotionSearchEmpty  No pages detected yet. Make sure you finished the "Connections" step in Notion, then hit refresh
errNotionCreateDb     Couldn't create the database — click to try again
```

- [ ] **Step 3: 验证 JSON 合法 + key 双语对齐**

Run:
```bash
node -e "
const en = require('./extension/_locales/en/messages.json');
const zh = require('./extension/_locales/zh_CN/messages.json');
const miss = [...Object.keys(zh).filter(k=>!en[k]), ...Object.keys(en).filter(k=>!zh[k])];
if (miss.length) { console.error('MISSING:', miss); process.exit(1); }
console.log('locales aligned,', Object.keys(zh).length, 'keys');
"
```
Expected: `locales aligned, ...`(退出码 0)

- [ ] **Step 4: 全量跑测试(i18n.test.mjs 里有 locale 对齐相关用例的话必须过)**

Run: `node --test 'tests/*.test.mjs'`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add extension/_locales
git commit -m "feat: i18n copy for onboarding wizard (zh + en)"
```

---

### Task 4: options 页重写 — 向导 UI 与总览态

**Files:**
- Modify: `extension/options/options.html`(整体重写)
- Modify: `extension/options/options.js`(整体重写)

**Interfaces:**
- Consumes:
  - Task 1 全部导出(`../lib/onboarding.js`)
  - Task 2 的 `notionAdapter.verifyToken/searchPages/createDatabase/test`
  - Task 3 全部 i18n key
  - 既有 `loadSettings/saveSettings`(`../lib/settings.js`)、`ADAPTERS`(`../lib/adapters/index.js`)、`t`(`../lib/i18n.js`)
- Produces: 无(终端 UI 层)

- [ ] **Step 1: 重写 `extension/options/options.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title data-i18n="extName"></title>
	<style>
		body {
			font-family: system-ui, -apple-system, sans-serif;
			max-width: 560px;
			margin: 40px auto;
			padding: 20px;
			line-height: 1.7;
			color: #333;
		}
		h1 { font-size: 20px; }
		h2 { font-size: 17px; margin: 0 0 4px; }
		[hidden] { display: none !important; }
		.intro { color: #555; font-size: 14px; margin: 0 0 12px; }
		ol.guide { font-size: 14px; padding-left: 20px; }
		ol.guide li { margin: 8px 0; }
		.progress { font-size: 13px; color: #888; margin-bottom: 12px; min-height: 18px; }
		.card-choice {
			display: block; width: 100%; text-align: left;
			border: 1.5px solid #ddd; border-radius: 10px; background: #fff;
			padding: 14px 16px; margin: 10px 0; cursor: pointer; font-size: 15px;
		}
		.card-choice:hover { border-color: #6366f1; background: #f5f5ff; }
		.card-choice .sub { display: block; font-size: 13px; color: #666; margin-top: 2px; }
		label { display: block; margin-top: 12px; font-size: 14px; }
		input {
			width: 100%; padding: 8px; margin-top: 4px;
			border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box;
		}
		input[type="password"] { font-family: monospace; font-size: 13px; }
		details { margin-top: 12px; font-size: 14px; }
		details summary { cursor: pointer; color: #666; }
		.btn {
			padding: 9px 16px; border: 0; border-radius: 6px;
			font-size: 14px; cursor: pointer; background: #e5e7eb; color: #111;
		}
		.btn.primary { background: #6366f1; color: #fff; }
		.btn.primary:hover { background: #4f46e5; }
		.btn.primary:disabled { background: #c7c8f8; cursor: not-allowed; }
		.btn.finish { background: #16a34a; color: #fff; }
		.btn.finish:disabled { background: #a7d9b9; cursor: not-allowed; }
		.nav { display: flex; justify-content: space-between; margin-top: 24px; }
		.nav .spacer { flex: 1; }
		.inline-status { font-size: 13px; margin-top: 8px; min-height: 18px; }
		.inline-status.ok { color: #16a34a; }
		.inline-status.bad { color: #dc2626; }
		.page-list { margin-top: 10px; }
		.page-item {
			display: block; width: 100%; text-align: left;
			border: 1.5px solid #ddd; border-radius: 6px; background: #fff;
			padding: 8px 12px; margin: 6px 0; cursor: pointer; font-size: 14px;
		}
		.page-item.selected { border-color: #6366f1; background: #f5f5ff; }
		.overview-card {
			border: 1px solid #ddd; border-radius: 10px; padding: 16px 20px; margin-top: 16px;
		}
		.status-light {
			display: inline-block; width: 10px; height: 10px; border-radius: 50%;
			margin-right: 6px; background: #d1d5db;
		}
		.status-light.ok { background: #16a34a; }
		.status-light.bad { background: #dc2626; }
		.muted { color: #666; font-size: 13px; }
		.done-list { font-size: 15px; padding-left: 20px; }
		.done-list li { margin: 10px 0; }
		.usage-hint { margin-top: 20px; color: #888; font-size: 13px; }
	</style>
</head>
<body>
	<h1 data-i18n="extName"></h1>
	<div class="progress" id="progress"></div>

	<!-- 总览态 -->
	<section data-step="overview" hidden>
		<h2 data-i18n="ovTitle"></h2>
		<div class="overview-card">
			<p id="ov-dest"></p>
			<p><span id="ov-light" class="status-light"></span><span id="ov-status" class="muted"></span></p>
			<p id="ov-detail" class="muted"></p>
			<p><a id="ov-db-link" href="#" target="_blank" data-i18n="ovOpenDb" hidden></a></p>
			<div class="nav">
				<button type="button" class="btn" id="ov-switch" data-i18n="ovSwitchDest"></button>
				<span class="spacer"></span>
				<button type="button" class="btn primary" id="ov-reconfigure" data-i18n="ovReconfigure"></button>
			</div>
		</div>
		<p class="usage-hint" data-i18n="ovUsage"></p>
	</section>

	<!-- 第 1 步:选目的地 -->
	<section data-step="choose" hidden>
		<h2 data-i18n="wizChooseTitle"></h2>
		<button type="button" class="card-choice" data-choose="obsidian">
			<strong data-i18n="dest_obsidian"></strong>
			<span class="sub" data-i18n="wizChooseObsidian"></span>
		</button>
		<button type="button" class="card-choice" data-choose="notion">
			<strong data-i18n="dest_notion"></strong>
			<span class="sub" data-i18n="wizChooseNotion"></span>
		</button>
	</section>

	<!-- Obsidian O1:装插件 -->
	<section data-step="obsidian-install" hidden>
		<h2 data-i18n="wizObInstallTitle"></h2>
		<p class="intro" data-i18n="wizObInstallIntro"></p>
		<ol class="guide">
			<li data-i18n="wizObInstallStep1"></li>
			<li data-i18n="wizObInstallStep2"></li>
			<li data-i18n="wizObInstallStep3"></li>
		</ol>
		<a class="btn primary" style="display:inline-block; text-decoration:none;"
			href="https://github.com/echore/obsidian-media-companion/releases/latest"
			target="_blank" data-i18n="wizObInstallDownload"></a>
		<div class="nav">
			<button type="button" class="btn" data-nav="back" data-i18n="wizBack"></button>
			<span class="spacer"></span>
			<button type="button" class="btn primary" data-nav="next" data-i18n="wizObInstallDone"></button>
		</div>
	</section>

	<!-- Obsidian O2:开 API、粘 key、测试 -->
	<section data-step="obsidian-connect" hidden>
		<h2 data-i18n="wizObConnectTitle"></h2>
		<ol class="guide">
			<li data-i18n="wizObConnectStep1"></li>
			<li data-i18n="wizObConnectStep2"></li>
			<li data-i18n="wizObConnectStep3"></li>
		</ol>
		<label for="apiKey" data-i18n="wizObKeyLabel"></label>
		<input id="apiKey" type="password" autocomplete="off">
		<details>
			<summary data-i18n="wizObAdvanced"></summary>
			<label for="port" data-i18n="optPort"></label>
			<input id="port" type="number" min="0" max="65535" value="27124">
		</details>
		<p class="muted" data-i18n="wizObTestHint"></p>
		<button type="button" class="btn" id="ob-test" data-i18n="optTestConnection"></button>
		<div class="inline-status" id="ob-test-status"></div>
		<div class="nav">
			<button type="button" class="btn" data-nav="back" data-i18n="wizBack"></button>
			<span class="spacer"></span>
			<button type="button" class="btn primary" id="ob-next" data-nav="next" data-i18n="wizNext" disabled></button>
		</div>
	</section>

	<!-- Obsidian O3:文件夹 + 完成 -->
	<section data-step="obsidian-folder" hidden>
		<h2 data-i18n="wizObFolderTitle"></h2>
		<p class="intro" data-i18n="wizObFolderHint"></p>
		<label for="folder" data-i18n="optFolder"></label>
		<input id="folder" type="text" value="灵感库">
		<div class="inline-status" id="ob-finish-status"></div>
		<div class="nav">
			<button type="button" class="btn" data-nav="back" data-i18n="wizBack"></button>
			<span class="spacer"></span>
			<button type="button" class="btn finish" id="ob-finish" data-i18n="wizFinish"></button>
		</div>
	</section>

	<!-- Notion N1:token -->
	<section data-step="notion-token" hidden>
		<h2 data-i18n="wizNoTokenTitle"></h2>
		<p class="intro" data-i18n="wizNoTokenIntro"></p>
		<ol class="guide">
			<li data-i18n="wizNoTokenStep1"></li>
			<li data-i18n="wizNoTokenStep2"></li>
			<li data-i18n="wizNoTokenStep3"></li>
		</ol>
		<a class="btn primary" style="display:inline-block; text-decoration:none;"
			href="https://www.notion.so/my-integrations" target="_blank" data-i18n="wizNoTokenOpen"></a>
		<label for="token" data-i18n="wizNoTokenLabel"></label>
		<input id="token" type="password" autocomplete="off">
		<button type="button" class="btn" id="no-verify" style="margin-top:10px" data-i18n="wizNoTokenVerify"></button>
		<div class="inline-status" id="no-verify-status"></div>
		<div class="nav">
			<button type="button" class="btn" data-nav="back" data-i18n="wizBack"></button>
			<span class="spacer"></span>
			<button type="button" class="btn primary" id="no-token-next" data-nav="next" data-i18n="wizNext" disabled></button>
		</div>
	</section>

	<!-- Notion N2:分享并选页面 -->
	<section data-step="notion-page" hidden>
		<h2 data-i18n="wizNoPageTitle"></h2>
		<p class="intro" data-i18n="wizNoPageIntro"></p>
		<ol class="guide">
			<li data-i18n="wizNoPageStep1"></li>
			<li data-i18n="wizNoPageStep2"></li>
			<li data-i18n="wizNoPageStep3"></li>
		</ol>
		<p class="muted" data-i18n="wizNoPageListHint"></p>
		<button type="button" class="btn" id="no-refresh" data-i18n="wizNoPageRefresh"></button>
		<div class="inline-status" id="no-refresh-status"></div>
		<div class="page-list" id="page-list"></div>
		<div class="nav">
			<button type="button" class="btn" data-nav="back" data-i18n="wizBack"></button>
			<span class="spacer"></span>
			<button type="button" class="btn primary" id="no-page-next" data-nav="next" data-i18n="wizNext" disabled></button>
		</div>
	</section>

	<!-- Notion N3:建库 + 完成 -->
	<section data-step="notion-database" hidden>
		<h2 data-i18n="wizNoDbTitle"></h2>
		<p class="intro" data-i18n="wizNoDbIntro"></p>
		<button type="button" class="btn primary" id="no-create-db" data-i18n="wizNoDbCreate"></button>
		<div class="inline-status" id="no-db-status"></div>
		<div class="nav">
			<button type="button" class="btn" data-nav="back" data-i18n="wizBack"></button>
			<span class="spacer"></span>
			<button type="button" class="btn finish" id="no-finish" data-i18n="wizFinish" disabled></button>
		</div>
	</section>

	<!-- 完成页 -->
	<section data-step="done" hidden>
		<h2 data-i18n="wizDoneTitle"></h2>
		<ul class="done-list">
			<li data-i18n="wizDoneShortcut"></li>
			<li data-i18n="wizDoneContext"></li>
			<li data-i18n="wizDonePopup"></li>
		</ul>
		<p class="intro" data-i18n="wizDoneTry"></p>
		<div class="nav">
			<span class="spacer"></span>
			<button type="button" class="btn primary" id="done-overview" data-i18n="ovTitle"></button>
		</div>
	</section>

	<script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: 重写 `extension/options/options.js`**

```js
import { loadSettings, saveSettings } from "../lib/settings.js";
import { ADAPTERS } from "../lib/adapters/index.js";
import { notionAdapter } from "../lib/adapters/notion.js";
import {
	sanitizeToken, nextStep, prevStep, firstCredentialStep, stepNumber,
} from "../lib/onboarding.js";
import { t } from "../lib/i18n.js";

document.querySelectorAll("[data-i18n]").forEach((el) => {
	el.textContent = t(el.dataset.i18n);
});

const $ = (sel) => document.querySelector(sel);

// —— 向导会话状态(不落盘;落盘只发生在"完成") ——
let dest = "";
let currentStep = "";
let selectedPage = null; // { id, title }
let pendingDatabaseId = ""; // N3 建好但还没保存的库

function obsidianCfg() {
	return {
		port: Number($("#port").value) || 27124,
		apiKey: $("#apiKey").value.trim(),
		folder: $("#folder").value.trim() || "灵感库",
	};
}
function notionCfg() {
	return { token: sanitizeToken($("#token").value), databaseId: pendingDatabaseId };
}

function show(step) {
	currentStep = step;
	document.querySelectorAll("[data-step]").forEach((s) => {
		s.hidden = s.dataset.step !== step;
	});
	const n = stepNumber(dest, step);
	$("#progress").textContent = n > 0 ? t("wizStepOf", [String(n)]) : "";
}

function setStatus(el, kind, msg) {
	el.className = `inline-status ${kind}`;
	el.textContent = msg;
}

// —— 总览态 ——
async function showOverview(settings) {
	dest = settings.chain[0];
	show("overview");
	$("#ov-dest").textContent = t("ovDest", [t(`dest_${dest}`)]);
	$("#ov-status").textContent = t("ovChecking");
	$("#ov-light").className = "status-light";
	const cfg = settings.byAdapter[dest];
	if (dest === "obsidian") {
		$("#ov-detail").textContent = t("ovFolderLine", [cfg.folder]);
		$("#ov-db-link").hidden = true;
	} else {
		$("#ov-detail").textContent = "";
		const link = $("#ov-db-link");
		link.hidden = false;
		link.href = `https://www.notion.so/${String(cfg.databaseId).replace(/-/g, "")}`;
	}
	const r = await ADAPTERS[dest].test(cfg);
	$("#ov-light").className = `status-light ${r.ok ? "ok" : "bad"}`;
	$("#ov-status").textContent = r.ok ? t("optConnected") : t(r.errorKey ?? "errGeneric");
}

// —— 启动:一页两态 ——
(async () => {
	const s = await loadSettings();
	// 表单预填(向导重入时不用重打)
	$("#port").value = s.byAdapter.obsidian.port ?? 27124;
	$("#apiKey").value = s.byAdapter.obsidian.apiKey ?? "";
	$("#folder").value = s.byAdapter.obsidian.folder ?? "灵感库";
	$("#token").value = s.byAdapter.notion.token ?? "";
	pendingDatabaseId = s.byAdapter.notion.databaseId ?? "";

	if (s.chain.length > 0) {
		showOverview(s);
	} else {
		show("choose");
	}
})();

// —— 通用导航 ——
document.querySelectorAll("[data-choose]").forEach((btn) => {
	btn.addEventListener("click", () => {
		dest = btn.dataset.choose;
		show(nextStep(dest, "choose"));
	});
});
document.querySelectorAll("[data-nav]").forEach((btn) => {
	btn.addEventListener("click", () => {
		const target = btn.dataset.nav === "next" ? nextStep(dest, currentStep) : prevStep(dest, currentStep);
		if (target) show(target);
	});
});
$("#ov-switch").addEventListener("click", () => show("choose"));
$("#ov-reconfigure").addEventListener("click", () => show(firstCredentialStep(dest)));
$("#done-overview").addEventListener("click", async () => showOverview(await loadSettings()));

// —— Obsidian O2:测试连接门禁 ——
const obNext = $("#ob-next");
$("#ob-test").addEventListener("click", async () => {
	const st = $("#ob-test-status");
	setStatus(st, "", "…");
	const r = await ADAPTERS.obsidian.test(obsidianCfg());
	if (r.ok) {
		setStatus(st, "ok", t("optConnected"));
		obNext.disabled = false;
	} else {
		setStatus(st, "bad", t(r.errorKey ?? "errGeneric"));
		obNext.disabled = true;
	}
});
// 改了 key/端口就得重测
for (const id of ["#apiKey", "#port"]) {
	$(id).addEventListener("input", () => { obNext.disabled = true; });
}

// —— Obsidian O3:完成 ——
$("#ob-finish").addEventListener("click", async () => {
	const s = await loadSettings();
	await saveSettings({
		chain: ["obsidian"],
		byAdapter: { ...s.byAdapter, obsidian: obsidianCfg() },
	});
	show("done");
});

// —— Notion N1:token 即时清洗 + 验证门禁 ——
const tokenInput = $("#token");
const noTokenNext = $("#no-token-next");
tokenInput.addEventListener("input", () => {
	const clean = sanitizeToken(tokenInput.value);
	if (clean !== tokenInput.value) tokenInput.value = clean;
	noTokenNext.disabled = true;
});
$("#no-verify").addEventListener("click", async () => {
	const st = $("#no-verify-status");
	setStatus(st, "", "…");
	const r = await notionAdapter.verifyToken({ token: sanitizeToken(tokenInput.value) });
	if (r.ok) {
		setStatus(st, "ok", t("wizNoTokenOk"));
		noTokenNext.disabled = false;
	} else {
		setStatus(st, "bad", t(r.errorKey ?? "errGeneric"));
		noTokenNext.disabled = true;
	}
});

// —— Notion N2:刷新并点选页面 ——
const noPageNext = $("#no-page-next");
$("#no-refresh").addEventListener("click", async () => {
	const st = $("#no-refresh-status");
	const list = $("#page-list");
	setStatus(st, "", "…");
	list.textContent = "";
	const r = await notionAdapter.searchPages({ token: sanitizeToken(tokenInput.value) });
	if (!r.ok) {
		setStatus(st, "bad", t(r.errorKey ?? "errGeneric"));
		noPageNext.disabled = true;
		return;
	}
	setStatus(st, "", "");
	for (const page of r.pages) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "page-item";
		btn.textContent = page.title || t("optUntitledPage");
		btn.addEventListener("click", () => {
			selectedPage = page;
			list.querySelectorAll(".page-item").forEach((b) => b.classList.remove("selected"));
			btn.classList.add("selected");
			noPageNext.disabled = false;
		});
		list.appendChild(btn);
	}
});

// —— Notion N3:建库(或沿用)+ 完成 ——
const noFinish = $("#no-finish");
const noDbStatus = $("#no-db-status");
async function runFullNotionTest() {
	const r = await notionAdapter.test(notionCfg());
	if (r.ok) {
		setStatus(noDbStatus, "ok", t("wizNoDbOk"));
		noFinish.disabled = false;
	} else {
		setStatus(noDbStatus, "bad", t(r.errorKey ?? "errGeneric"));
		noFinish.disabled = true;
	}
	return r.ok;
}
// 进入 N3 时探测"重入沿用"场景:已有库且还测得通,就不用重复建
document.querySelector('[data-step="notion-database"]').addEventListener("step-enter", async () => {
	if (!pendingDatabaseId) return;
	if (await runFullNotionTest()) setStatus(noDbStatus, "ok", t("wizNoDbExisting"));
});
$("#no-create-db").addEventListener("click", async () => {
	setStatus(noDbStatus, "", "…");
	const r = await notionAdapter.createDatabase(
		{ token: sanitizeToken(tokenInput.value) },
		selectedPage?.id,
		t("extName")
	);
	if (!r.ok) {
		setStatus(noDbStatus, "bad", t(r.errorKey ?? "errGeneric"));
		return;
	}
	pendingDatabaseId = r.databaseId;
	await runFullNotionTest();
});
$("#no-finish").addEventListener("click", async () => {
	const s = await loadSettings();
	await saveSettings({
		chain: ["notion"],
		byAdapter: { ...s.byAdapter, notion: notionCfg() },
	});
	show("done");
});
```

注意:上面 `step-enter` 是自定义事件,需要 `show()` 派发。在 `show()` 里 `s.hidden = ...` 之后追加:

```js
	const active = document.querySelector(`[data-step="${step}"]`);
	if (active) active.dispatchEvent(new CustomEvent("step-enter"));
```

(放在 `document.querySelectorAll("[data-step]")` 循环之后、progress 更新之前。)

- [ ] **Step 3: 全量跑测试**

Run: `node --test 'tests/*.test.mjs'`
Expected: 全绿(本 task 不新增单测——DOM 布线层,与仓库既有约定一致)

- [ ] **Step 4: 手动冒烟(chrome://extensions → 加载已解压 → 打开设置页)**

- 无配置时打开:进"choose",两张卡片文案完整
- 走 Notion 分支到 N1:粘一个带尖括号的假 token,输入框立即变干净;点"验证"给红字
- 走 Obsidian 分支:O2 不点测试时"下一步"保持灰色
- **不要在 chrome://newtab 或浏览器设置页上测截图**(已知踩坑)

- [ ] **Step 5: Commit**

```bash
git add extension/options
git commit -m "feat: rewrite options page as guided onboarding wizard (one page, two states)"
```

---

### Task 5: 首装自动打开设置页

**Files:**
- Modify: `extension/background.js:145-153`(既有 `onInstalled` 监听器)

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 修改既有监听器**(不要新增第二个 `onInstalled` 监听——把逻辑并进现有那个):

```js
chrome.runtime.onInstalled.addListener((details) => {
	// 首次安装直接带用户进配置向导;更新/重载不打扰
	if (details?.reason === "install") chrome.runtime.openOptionsPage();
	chrome.contextMenus.removeAll(() => {
		chrome.contextMenus.create({
			id: "insp-save-image",
			title: t("ctxSaveImage"),
			contexts: ["image", "video"],
		});
	});
});
```

- [ ] **Step 2: 手动验证**

chrome://extensions 移除扩展后重新"加载已解压"(等效一次 install)→ 设置页自动弹出并停在"choose"。

- [ ] **Step 3: 全量跑测试 + Commit**

Run: `node --test 'tests/*.test.mjs'` → 全绿

```bash
git add extension/background.js
git commit -m "feat: open onboarding wizard automatically on first install"
```

---

### Task 6: 收尾验证

**Files:** 无新改动(只验证)

- [ ] **Step 1: 全量测试**

Run: `node --test 'tests/*.test.mjs'`
Expected: 全绿

- [ ] **Step 2: 对照 spec 验收标准逐条手测**(spec `## 验收标准` 7 条),重点:

1. 首装自动打开 → choose
2. Obsidian 全分支走通(真机:Obsidian + MC fork)
3. Notion 全分支走通:token 验证 → 分享页面 → 刷新点选 → 一键建库 → 绿灯 → 完成;去 Notion 确认库和 5 列都在
4. 尖括号 token 自动清洗
5. 把 Notion 页面与 integration 断开连接后,总览态状态灯变红且文案是 `errNotionDatabase`
6. 总览态"重新配置"落在凭据步且表单预填;"换个地方存"回 choose
7. 切浏览器语言为 en 抽查三处文案

- [ ] **Step 3: 有问题回对应 task 修;全过则报告完成**
