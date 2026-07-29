# 多目的地适配器层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扩展现在硬编码到 Media Companion 的单一上传路径，重构成「捕获层 → 路由层 → 适配器层」三段结构，并交付 Obsidian 与 Notion 两个可用目的地、体积降级链、中英双语。

**Architecture:** 捕获层继续产出 base64 + 元数据（不改），新增一个纯函数 `CaptureItem` 作为统一载体。路由层根据各 adapter 实探出的 `capabilities()` 决定投递目标，超限则降级到备选。适配器层统一四方法接口，同时套住两种形态：Obsidian 是 localhost 单次 PUT，Notion 是云端三步握手。所有决策逻辑做成纯函数放 `lib/`，I/O 包装层保持极薄，测试全部打在纯函数上。

**Tech Stack:** Chrome MV3 (service worker, ES modules)、`node --test`（无 package.json，裸跑）、`chrome.i18n` + `_locales`、Obsidian Local REST API、Notion API `2026-03-11`。

## Global Constraints

- **零服务器**：任何需要自建服务端的方案一律不采纳（这是硬约束，不是偏好）。
- **不使用 File System Access API**（理由见 spec「安全立场」）。
- **不静默失败**：任何写入失败必须有可见 toast，含原因；`showToast` 已有 badge 兜底路径，沿用。
- **Notion API 版本固定 `Notion-Version: 2026-03-11`**。
- **Obsidian 走明文 HTTP `http://127.0.0.1:27123`**，不走 27124 HTTPS（自签证书，扩展 fetch 无法绕过）。
- **中英双语**：所有面向用户的字符串走 `chrome.i18n.getMessage`，`_locales/en` 与 `_locales/zh_CN` 条目数必须相等。
- **测试用 `node --test` 裸跑**（Node 24），仓库无 package.json，不要引入。
- **纯函数与 I/O 分离**：凡带 `chrome.*` 或 `fetch` 的代码不写测试；决策逻辑必须抽成纯函数并测。
- **提交粒度**：每个 Task 结束提交一次，信息写清「为什么」。

---

## File Structure

**新建**

| 文件 | 职责 |
|---|---|
| `extension/lib/capture-item.js` | `CaptureItem` 工厂 + 体积计算，纯函数 |
| `extension/lib/router.js` | 目的地选择与降级决策，纯函数 |
| `extension/lib/settings.js` | `chrome.storage.local` 读写各 adapter 配置，薄包装 |
| `extension/lib/i18n.js` | `chrome.i18n` 薄包装 + 测试环境回退 |
| `extension/lib/adapters/index.js` | adapter 注册表 |
| `extension/lib/adapters/obsidian.js` | Obsidian Local REST API adapter |
| `extension/lib/adapters/notion.js` | Notion 三步上传 adapter |
| `extension/options/options.html` / `.js` | 各 adapter 配置页 |
| `extension/_locales/en/messages.json` | 英文文案 |
| `extension/_locales/zh_CN/messages.json` | 中文文案 |
| `tests/capture-item.test.mjs` | |
| `tests/router.test.mjs` | |
| `tests/adapters.test.mjs` | 请求塑形与 capabilities 解析的纯函数部分 |

**修改**

| 文件 | 改动 |
|---|---|
| `extension/lib/helpers.js` | 保留纯函数；`buildUploadBody` 与 `friendlyError` 迁走/重写 |
| `extension/background.js:23-30` | `saveToLibrary` 改为走路由层 |
| `extension/manifest.json` | 加 `storage` 权限、`options_page`、`default_locale`、`__MSG_` 化 |
| `extension/popup/popup.js` | 状态卡显示多目的地 |

**删除**（需确认后执行）

| 文件 | 原因 |
|---|---|
| `extension/lib/upload.js` | 被 `adapters/obsidian.js` 取代；Media Companion 的 `/api/upload` 不再使用 |
| `extension/config.local.js` / `.example.js` | 配置迁到 `chrome.storage`，由 options 页管理 |
| `scripts/setup-key.sh` | 同上；key 改为用户在 options 页粘贴 |

> ⚠️ 删除前必须先向用户确认（仓库规约：删除任何东西都要先问）。Task 4 会用到这三者的替代品全部就位后才提出删除。

---

## Task 1: CaptureItem 与体积计算

**Files:**
- Create: `extension/lib/capture-item.js`
- Create: `tests/capture-item.test.mjs`
- Modify: `extension/lib/helpers.js`（追加 `byteLengthFromBase64`）
- Modify: `tests/helpers.test.mjs`（追加用例）

**Interfaces:**
- Consumes: 现有 `helpers.js` 的 `sanitizeTitle`、`buildFilename`
- Produces:
  - `byteLengthFromBase64(b64: string) => number`
  - `makeCaptureItem({ base64, ext, mime, title, sourceUrl, now }) => CaptureItem`
  - `CaptureItem = { base64, ext, mime, filename, title, sourceUrl, sourceTitle, capturedAt, byteLength }`

- [ ] **Step 1: 写失败的测试**

`tests/helpers.test.mjs` 追加：

```js
import { byteLengthFromBase64 } from "../extension/lib/helpers.js";

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
```

`tests/capture-item.test.mjs` 新建：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/liyachen/Documents/fang/inspiration-clipper && node --test tests/`
Expected: FAIL — `byteLengthFromBase64 is not a function` / 找不到 `capture-item.js`

- [ ] **Step 3: 最小实现**

`extension/lib/helpers.js` 追加：

```js
// base64 解码后的真实字节数。路由层用它判断是否超过目的地上限，
// 不能用 b64.length 近似 —— 33% 的膨胀会让 5MB 的门槛误判。
export function byteLengthFromBase64(b64) {
	if (!b64) return 0;
	const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
	return Math.floor((b64.length * 3) / 4) - padding;
}
```

`extension/lib/capture-item.js` 新建：

```js
// extension/lib/capture-item.js — 捕获层与适配器层之间的唯一载体。纯函数，无 chrome API。
import { sanitizeTitle, buildFilename, byteLengthFromBase64 } from "./helpers.js";

export function makeCaptureItem({ base64, ext, mime, title, sourceUrl, now }) {
	return {
		base64,
		ext,
		mime,
		filename: buildFilename(title, now, ext),
		title,
		sourceTitle: sanitizeTitle(title),
		sourceUrl: sourceUrl || "",
		capturedAt: now,
		byteLength: byteLengthFromBase64(base64),
	};
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/`
Expected: PASS，全部用例绿

- [ ] **Step 5: 提交**

```bash
git add extension/lib/capture-item.js extension/lib/helpers.js tests/capture-item.test.mjs tests/helpers.test.mjs
git commit -m "feat: CaptureItem carrier and exact base64 byte size

Byte size must be exact, not the base64 length: the 33% inflation would
misjudge Notion's 5MB ceiling and route a savable GIF to the fallback."
```

---

## Task 2: 路由层与降级决策

**Files:**
- Create: `extension/lib/router.js`
- Create: `tests/router.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `CaptureItem`
- Produces:
  - `chooseDestination(item, chain, capsById) => { adapterId, degradedFrom } | { error }`
  - `chain: string[]` —— 用户配置的目的地优先级，如 `["notion", "obsidian"]`
  - `capsById: { [id]: { maxFileSize: number } }` —— `maxFileSize` 为 `Infinity` 表示无限
  - 返回的 `degradedFrom` 为 `null` 或被跳过的首选 adapterId

- [ ] **Step 1: 写失败的测试**

`tests/router.test.mjs`：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/router.test.mjs`
Expected: FAIL — 找不到 `router.js`

- [ ] **Step 3: 最小实现**

```js
// extension/lib/router.js — 决定这一件捕获物去哪儿。纯函数，无 chrome API、无 fetch。
// 策略住在这里，不住在 adapter 里：adapter 只回答"我能不能存"，
// "存不下该去哪"是策略问题。

export function chooseDestination(item, chain, capsById) {
	if (!chain || chain.length === 0) return { error: "noDestination" };

	let firstLimit = null;
	let degradedFrom = null;

	for (const id of chain) {
		const caps = capsById[id];
		// 能力未知 = 没连上或没探测过。跳过而不是赌它能装下 ——
		// 猜错的代价是静默丢件。
		if (!caps) {
			if (degradedFrom === null) degradedFrom = id;
			continue;
		}
		if (firstLimit === null) firstLimit = caps.maxFileSize;
		if (item.byteLength <= caps.maxFileSize) {
			return { adapterId: id, degradedFrom };
		}
		if (degradedFrom === null) degradedFrom = id;
	}

	return {
		error: "tooLargeForAll",
		byteLength: item.byteLength,
		maxFileSize: firstLimit ?? 0,
	};
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/router.test.mjs`
Expected: PASS（6 个用例）

- [ ] **Step 5: 提交**

```bash
git add extension/lib/router.js tests/router.test.mjs
git commit -m "feat: destination router with size-based degradation

Unknown capabilities skip rather than assume: guessing wrong means a
silently dropped capture, which is the one failure mode this project
exists to prevent."
```

---

## Task 3: Adapter 接口与 ObsidianAdapter

**Files:**
- Create: `extension/lib/adapters/obsidian.js`
- Create: `extension/lib/adapters/index.js`
- Create: `tests/adapters.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `CaptureItem`
- Produces（所有 adapter 必须实现的四方法）：
  - `id: string`
  - `test(cfg) => Promise<{ ok: boolean, capabilities?: {maxFileSize:number}, errorKey?: string }>`
  - `capabilities(cfg) => { maxFileSize: number }`（同步，返回上次 `test` 缓存或保守默认）
  - `save(item, cfg) => Promise<void>`（失败时 throw `{ errorKey, status? }`）
- 纯函数导出（供测试）：
  - `obsidianVaultPath(folder, filename) => string`
  - `obsidianSidecar(item) => string`

**背景（实现者必读）：** Obsidian Local REST API 默认监听 **HTTPS 27124 且使用自签证书**，浏览器扩展的 `fetch` 无法绕过证书错误。**必须走明文 HTTP `http://127.0.0.1:27123`**，用户需在 *Settings → Local REST API → Enable HTTP server* 手动打开。`GET /` 是免鉴权的状态检查端点。写文件用 `PUT /vault/{path}`，支持二进制。

- [ ] **Step 1: 写失败的测试**

`tests/adapters.test.mjs`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { obsidianVaultPath, obsidianSidecar } from "../extension/lib/adapters/obsidian.js";

test("obsidianVaultPath joins folder and filename and percent-encodes each segment", () => {
	assert.equal(obsidianVaultPath("灵感库", "a b.gif"), "%E7%81%B5%E6%84%9F%E5%BA%93/a%20b.gif");
});
test("obsidianVaultPath tolerates a folder with stray slashes", () => {
	assert.equal(obsidianVaultPath("/inbox/", "x.png"), "inbox/x.png");
});
test("obsidianVaultPath handles a nested folder", () => {
	assert.equal(obsidianVaultPath("a/b", "x.png"), "a/b/x.png");
});
test("obsidianSidecar emits frontmatter with source and capture time", () => {
	const md = obsidianSidecar({
		filename: "x-5.gif",
		sourceUrl: "https://a.com/p",
		sourceTitle: "Title",
		capturedAt: 1722180000000,
	});
	assert.match(md, /^---\n/);
	assert.match(md, /sourceUrl: "https:\/\/a\.com\/p"/);
	assert.match(md, /sourceTitle: "Title"/);
	assert.match(md, /capturedAt: 2024-07-28T/);
	assert.match(md, /!\[\[x-5\.gif\]\]/);
});
test("obsidianSidecar escapes double quotes in the title", () => {
	const md = obsidianSidecar({ filename: "x.png", sourceUrl: "", sourceTitle: 'a"b', capturedAt: 0 });
	assert.match(md, /sourceTitle: "a\\"b"/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/adapters.test.mjs`
Expected: FAIL — 找不到 `adapters/obsidian.js`

- [ ] **Step 3: 最小实现**

```js
// extension/lib/adapters/obsidian.js
// 写入走 obsidian-local-rest-api 社区插件。必须用明文 HTTP 端点：
// 该插件默认的 HTTPS 27124 用自签证书，扩展的 fetch 无法绕过证书错误。
// 用户需在 Settings → Local REST API → Enable HTTP server 打开 27123。

const DEFAULT_PORT = 27123;

export function obsidianVaultPath(folder, filename) {
	const parts = String(folder || "")
		.split("/")
		.filter(Boolean)
		.concat(filename);
	return parts.map(encodeURIComponent).join("/");
}

function q(s) {
	return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function obsidianSidecar(item) {
	return [
		"---",
		`sourceUrl: "${q(item.sourceUrl)}"`,
		`sourceTitle: "${q(item.sourceTitle)}"`,
		`capturedAt: ${new Date(item.capturedAt).toISOString()}`,
		"tags: []",
		"---",
		"",
		`![[${item.filename}]]`,
		"",
	].join("\n");
}

function base(cfg) {
	return `http://127.0.0.1:${cfg.port || DEFAULT_PORT}`;
}

function bytesFromBase64(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

let cachedCaps = { maxFileSize: Infinity };

export const obsidianAdapter = {
	id: "obsidian",

	async test(cfg) {
		try {
			// GET / 是免鉴权的状态端点，先确认服务在；再用一次带鉴权的
			// 目录列举确认 key 对。两步分开，才能区分"没开"和"钥匙错"。
			const alive = await fetch(`${base(cfg)}/`);
			if (!alive.ok) return { ok: false, errorKey: "errObsidianClosed" };
			const authed = await fetch(`${base(cfg)}/vault/`, {
				headers: { Authorization: `Bearer ${cfg.apiKey}` },
			});
			if (authed.status === 401) return { ok: false, errorKey: "errObsidianKey" };
			if (!authed.ok) return { ok: false, errorKey: "errObsidianGeneric" };
			return { ok: true, capabilities: cachedCaps };
		} catch {
			return { ok: false, errorKey: "errObsidianClosed" };
		}
	},

	capabilities() {
		return cachedCaps;
	},

	async save(item, cfg) {
		const headers = { Authorization: `Bearer ${cfg.apiKey}` };
		const mediaRes = await fetch(
			`${base(cfg)}/vault/${obsidianVaultPath(cfg.folder, item.filename)}`,
			{ method: "PUT", headers: { ...headers, "Content-Type": item.mime }, body: bytesFromBase64(item.base64) }
		).catch(() => { throw { errorKey: "errObsidianClosed" }; });
		if (!mediaRes.ok) throw { errorKey: "errObsidianGeneric", status: mediaRes.status };

		const sidecarName = `${item.filename}.md`;
		const sidecarRes = await fetch(
			`${base(cfg)}/vault/${obsidianVaultPath(cfg.folder, sidecarName)}`,
			{ method: "PUT", headers: { ...headers, "Content-Type": "text/markdown" }, body: obsidianSidecar(item) }
		).catch(() => { throw { errorKey: "errSidecarFailed" }; });
		// 媒体已经落地了 —— sidecar 失败只丢元数据，不该把整次捕获报成失败。
		if (!sidecarRes.ok) throw { errorKey: "errSidecarFailed", status: sidecarRes.status };
	},
};
```

```js
// extension/lib/adapters/index.js
import { obsidianAdapter } from "./obsidian.js";

export const ADAPTERS = { obsidian: obsidianAdapter };
export function getAdapter(id) {
	return ADAPTERS[id] ?? null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/`
Expected: PASS，全部用例绿

- [ ] **Step 5: 提交**

```bash
git add extension/lib/adapters/ tests/adapters.test.mjs
git commit -m "feat: adapter interface and ObsidianAdapter over Local REST API

Plain HTTP on 27123, not the default HTTPS 27124: that endpoint uses a
self-signed cert and an extension's fetch cannot bypass a cert error.
Requires the user to enable the HTTP server in plugin settings.

test() probes liveness and auth separately so 'Obsidian is closed' and
'wrong key' produce different messages."
```

---

## Task 4: 配置存储与接线，替换 upload.js

**Files:**
- Create: `extension/lib/settings.js`
- Modify: `extension/background.js:1-3, 23-30`
- Modify: `extension/manifest.json`（加 `storage` 权限）

**Interfaces:**
- Consumes: Task 2 `chooseDestination`、Task 3 `getAdapter`
- Produces:
  - `loadSettings() => Promise<{ chain: string[], byAdapter: {[id]: object} }>`
  - `saveSettings(next) => Promise<void>`
  - `probeAll() => Promise<{[id]: {maxFileSize:number}}>`
  - `saveToLibrary(tabId, { base64, ext, mime, title, sourceUrl })` —— 签名变更，调用方需同步

- [ ] **Step 1: 写 settings 的默认值测试**

`tests/settings.test.mjs`（只测纯函数部分）：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { withDefaults } from "../extension/lib/settings.js";

test("withDefaults supplies an empty chain and per-adapter defaults", () => {
	const s = withDefaults(undefined);
	assert.deepEqual(s.chain, []);
	assert.equal(s.byAdapter.obsidian.port, 27123);
	assert.equal(s.byAdapter.obsidian.folder, "灵感库");
	assert.equal(s.byAdapter.obsidian.apiKey, "");
});
test("withDefaults preserves stored values over defaults", () => {
	const s = withDefaults({ chain: ["obsidian"], byAdapter: { obsidian: { port: 9999 } } });
	assert.deepEqual(s.chain, ["obsidian"]);
	assert.equal(s.byAdapter.obsidian.port, 9999);
	assert.equal(s.byAdapter.obsidian.folder, "灵感库");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/settings.test.mjs`
Expected: FAIL — 找不到 `settings.js`

- [ ] **Step 3: 实现 settings.js**

```js
// extension/lib/settings.js — 配置读写。纯函数 withDefaults 可测；其余是 chrome.storage 薄包装。
import { ADAPTERS } from "./adapters/index.js";

const DEFAULTS = {
	obsidian: { port: 27123, apiKey: "", folder: "灵感库" },
	notion: { token: "", databaseId: "" },
};

export function withDefaults(stored) {
	const s = stored || {};
	const byAdapter = {};
	for (const [id, d] of Object.entries(DEFAULTS)) {
		byAdapter[id] = { ...d, ...((s.byAdapter || {})[id] || {}) };
	}
	return { chain: s.chain || [], byAdapter };
}

export async function loadSettings() {
	const { settings } = await chrome.storage.local.get("settings");
	return withDefaults(settings);
}

export async function saveSettings(next) {
	await chrome.storage.local.set({ settings: next });
}

export async function probeAll() {
	const s = await loadSettings();
	const caps = {};
	for (const id of s.chain) {
		const a = ADAPTERS[id];
		if (!a) continue;
		const r = await a.test(s.byAdapter[id]);
		if (r.ok) caps[id] = r.capabilities ?? a.capabilities(s.byAdapter[id]);
	}
	return caps;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/settings.test.mjs`
Expected: PASS

- [ ] **Step 5: 改 background.js 走路由**

`extension/background.js` 顶部三行 import 替换为：

```js
import { makeCaptureItem } from "./lib/capture-item.js";
import { chooseDestination } from "./lib/router.js";
import { getAdapter } from "./lib/adapters/index.js";
import { loadSettings, probeAll } from "./lib/settings.js";
import { extFromContentType, pickExt } from "./lib/helpers.js";
import { t } from "./lib/i18n.js";
```

`saveToLibrary`（原 23-30 行）整体替换为：

```js
const MIME_BY_EXT = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
	avif: "image/avif", bmp: "image/bmp", gif: "image/gif", svg: "image/svg+xml",
	mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", ogv: "video/ogg",
};

export async function saveToLibrary(tabId, { base64, ext = "png", title, sourceUrl }) {
	const item = makeCaptureItem({
		base64, ext, mime: MIME_BY_EXT[ext] ?? "application/octet-stream",
		title, sourceUrl, now: Date.now(),
	});
	const settings = await loadSettings();
	const caps = await probeAll();
	const decision = chooseDestination(item, settings.chain, caps);

	if (decision.error === "noDestination") {
		await showToast(tabId, t("errNoDestination"), false);
		return;
	}
	if (decision.error === "tooLargeForAll") {
		await showToast(tabId, t("errTooLarge", [mb(decision.byteLength), mb(decision.maxFileSize)]), false);
		return;
	}

	const adapter = getAdapter(decision.adapterId);
	try {
		await adapter.save(item, settings.byAdapter[decision.adapterId]);
		const msg = decision.degradedFrom
			? t("okSavedDegraded", [t(`dest_${decision.adapterId}`), t(`dest_${decision.degradedFrom}`)])
			: t("okSaved", [t(`dest_${decision.adapterId}`)]);
		await showToast(tabId, msg, true);
	} catch (e) {
		await showToast(tabId, t(e?.errorKey ?? "errGeneric"), false);
	}
}

function mb(bytes) {
	return (bytes / 1024 / 1024).toFixed(1);
}
```

同时把三处调用点从 `imageBase64:` 改为 `base64:`：`background.js` 中 `saveToLibrary(tab.id, { imageBase64: b64, …})` 共 2 处（data: URL 分支、右键取图分支）、`saveToLibrary(tabId, { imageBase64: b64, …})` 1 处（框选分支）。框选分支需补 `ext: "png"`。

`extension/manifest.json` 的 `permissions` 改为：

```json
"permissions": ["contextMenus", "activeTab", "scripting", "storage"],
```

- [ ] **Step 6: 手动验证端到端**

1. `chrome://extensions` 重新加载扩展
2. 在 Obsidian 里装 Local REST API 插件，打开 *Enable HTTP server*，复制 API key
3. 暂时用 DevTools console 手动写入配置（options 页在 Task 6）：
   ```js
   chrome.storage.local.set({ settings: { chain: ["obsidian"], byAdapter: { obsidian: { port: 27123, apiKey: "<粘贴>", folder: "灵感库" } } } })
   ```
4. 任意网页 `Alt+Shift+S` 框选 → 期望 vault 的 `灵感库/` 下出现图片 + 同名 `.md`
5. 关掉 Obsidian 再截一次 → 期望 toast 报"Obsidian 没开"，不是静默失败

- [ ] **Step 7: 提交**

```bash
git add extension/lib/settings.js extension/background.js extension/manifest.json tests/settings.test.mjs
git commit -m "feat: route captures through adapters instead of a hardcoded endpoint

saveToLibrary no longer knows where things go. It builds a CaptureItem,
asks the router, and hands off. Config moves to chrome.storage so a
second destination can be added without touching the capture path."
```

- [ ] **Step 8: 向用户确认删除旧文件**

`extension/lib/upload.js`、`extension/config.local.js`、`extension/config.local.example.js`、`scripts/setup-key.sh` 均已无引用。**先问用户，得到明确同意再删**，然后：

```bash
git rm extension/lib/upload.js extension/config.local.js extension/config.local.example.js scripts/setup-key.sh
git commit -m "chore: drop Media Companion upload path and file-based key setup"
```

---

## Task 5: NotionAdapter

**Files:**
- Create: `extension/lib/adapters/notion.js`
- Modify: `extension/lib/adapters/index.js`
- Modify: `tests/adapters.test.mjs`

**Interfaces:**
- Consumes: Task 1 `CaptureItem`、Task 3 的四方法约定
- Produces:
  - `notionCapsFromBotUser(json) => { maxFileSize: number }`
  - `notionPageProperties(item) => object`
  - `notionAdapter`（四方法）

**背景（实现者必读）：** 三步上传 ——
1. `POST https://api.notion.com/v1/file_uploads`，body `{filename, content_type}` → 返回 `{ id, upload_url }`
2. `POST {upload_url}`，`multipart/form-data`，字段名 `file`
3. `POST https://api.notion.com/v1/pages`，`parent.database_id`，属性里引用 `file_upload`

能力实探：`GET https://api.notion.com/v1/users/me` → `bot.workspace_limits.max_file_upload_size_in_bytes`（免费 workspace 为 `5242880`）。
所有请求带 `Authorization: Bearer <token>` 与 `Notion-Version: 2026-03-11`。

- [ ] **Step 1: 先核对官方文档，确认属性挂载的确切 JSON**

打开 https://developers.notion.com/guides/data-apis/working-with-files-and-media 的「Attaching a file upload」小节，确认把已完成的 `file_upload` 挂到**数据库页面的 files 属性**上的确切形状。本计划假定为：

```json
{ "Image": { "files": [ { "type": "file_upload", "file_upload": { "id": "<id>" }, "name": "<filename>" } ] } }
```

**若文档与此不符，以文档为准并同步改下面 Step 3 的 `notionPageProperties`。** 这是本计划唯一未经实证的接口形状。

- [ ] **Step 2: 写失败的测试**

`tests/adapters.test.mjs` 追加：

```js
import { notionCapsFromBotUser, notionPageProperties } from "../extension/lib/adapters/notion.js";

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
});
test("notionPageProperties omits an empty source url rather than sending an empty string", () => {
	const props = notionPageProperties({ filename: "x.png", sourceTitle: "T", sourceUrl: "", capturedAt: 0 }, "u");
	assert.deepEqual(props["Source URL"], { url: null });
});
```

- [ ] **Step 3: 跑测试确认失败，然后实现**

Run: `node --test tests/adapters.test.mjs` → FAIL

```js
// extension/lib/adapters/notion.js
// 三步上传：建 file_upload 对象 → 传字节 → 建 database page 引用它。
// 属性名必须与 spec「组件 4」的 Notion 模板一致。

const API = "https://api.notion.com/v1";
const VERSION = "2026-03-11";
const FREE_TIER_LIMIT = 5 * 1024 * 1024;

export function notionCapsFromBotUser(json) {
	const n = json?.bot?.workspace_limits?.max_file_upload_size_in_bytes;
	// 读不到就按免费版的 5MB 算。保守取小 —— 误降级到 Obsidian 只是位置不同，
	// 高估上限则是传到一半才失败。
	return { maxFileSize: typeof n === "number" ? n : FREE_TIER_LIMIT };
}

export function notionPageProperties(item, fileUploadId) {
	return {
		Name: { title: [{ text: { content: item.filename } }] },
		Image: { files: [{ type: "file_upload", file_upload: { id: fileUploadId }, name: item.filename }] },
		"Source URL": { url: item.sourceUrl || null },
		"Source Title": { rich_text: [{ text: { content: item.sourceTitle } }] },
		Captured: { date: { start: new Date(item.capturedAt).toISOString() } },
	};
}

function headers(cfg) {
	return { Authorization: `Bearer ${cfg.token}`, "Notion-Version": VERSION };
}

function blobFromBase64(b64, mime) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new Blob([bytes], { type: mime });
}

let cachedCaps = { maxFileSize: FREE_TIER_LIMIT };

export const notionAdapter = {
	id: "notion",

	async test(cfg) {
		if (!cfg.token || !cfg.databaseId) return { ok: false, errorKey: "errNotionUnconfigured" };
		try {
			const res = await fetch(`${API}/users/me`, { headers: headers(cfg) });
			if (res.status === 401) return { ok: false, errorKey: "errNotionToken" };
			if (!res.ok) return { ok: false, errorKey: "errNotionGeneric" };
			cachedCaps = notionCapsFromBotUser(await res.json());
			return { ok: true, capabilities: cachedCaps };
		} catch {
			return { ok: false, errorKey: "errNotionUnreachable" };
		}
	},

	capabilities() {
		return cachedCaps;
	},

	async save(item, cfg) {
		const createRes = await fetch(`${API}/file_uploads`, {
			method: "POST",
			headers: { ...headers(cfg), "Content-Type": "application/json" },
			body: JSON.stringify({ filename: item.filename, content_type: item.mime }),
		});
		if (!createRes.ok) throw { errorKey: "errNotionGeneric", status: createRes.status };
		const { id, upload_url } = await createRes.json();

		const form = new FormData();
		form.append("file", blobFromBase64(item.base64, item.mime), item.filename);
		// 不要手写 Content-Type：boundary 必须由 FormData 自己生成
		const sendRes = await fetch(upload_url, { method: "POST", headers: headers(cfg), body: form });
		if (!sendRes.ok) throw { errorKey: "errNotionUploadFailed", status: sendRes.status };

		const pageRes = await fetch(`${API}/pages`, {
			method: "POST",
			headers: { ...headers(cfg), "Content-Type": "application/json" },
			body: JSON.stringify({
				parent: { database_id: cfg.databaseId },
				properties: notionPageProperties(item, id),
			}),
		});
		if (!pageRes.ok) throw { errorKey: "errNotionPageFailed", status: pageRes.status };
	},
};
```

`extension/lib/adapters/index.js` 改为：

```js
import { obsidianAdapter } from "./obsidian.js";
import { notionAdapter } from "./notion.js";

export const ADAPTERS = { obsidian: obsidianAdapter, notion: notionAdapter };
export function getAdapter(id) {
	return ADAPTERS[id] ?? null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/`
Expected: PASS

- [ ] **Step 5: 手动验证端到端（含降级）**

1. 在 Notion 建 integration（notion.so/my-integrations），复制 `ntn_` token
2. 打开 spec「组件 4」记录的模板数据库（`3ac942e6a59280a5be6ce2122761f02d`），`···` → Connections → 添加该 integration
3. console 写入配置：
   ```js
   chrome.storage.local.set({ settings: { chain: ["notion", "obsidian"], byAdapter: {
     notion: { token: "<ntn_...>", databaseId: "3ac942e6a59280a5be6ce2122761f02d" },
     obsidian: { port: 27123, apiKey: "<key>", folder: "灵感库" } } } })
   ```
4. 截一张小图 → 期望出现在 Notion 数据库，画廊里能看到封面
5. **右键存一个 >5MB 的 GIF** → 期望 toast 说明超限并已改存 Obsidian，且文件确实在 vault 里

- [ ] **Step 6: 提交**

```bash
git add extension/lib/adapters/notion.js extension/lib/adapters/index.js tests/adapters.test.mjs
git commit -m "feat: NotionAdapter with three-step upload and live capability probe

maxFileSize is read from the bot user's workspace_limits rather than
hardcoded: the same adapter faces 5MB on a free workspace and 5GB on a
paid one. Unknown reads fall back to the smaller value so a miss
degrades to Obsidian instead of failing mid-upload."
```

---

## Task 6: i18n 双语

**Files:**
- Create: `extension/lib/i18n.js`
- Create: `extension/_locales/en/messages.json`
- Create: `extension/_locales/zh_CN/messages.json`
- Create: `tests/i18n.test.mjs`
- Modify: `extension/manifest.json`、`extension/background.js`（替换硬编码中文）

**Interfaces:**
- Produces: `t(key, substitutions?) => string`

**参照物：** `../screenshot-clipper/extension/_locales/{en,zh_CN}/messages.json`，各 226 条、完全同步。沿用同样的 key 命名风格。

- [ ] **Step 1: 写"两套文案 key 必须一致"的测试**

`tests/i18n.test.mjs`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const en = JSON.parse(readFileSync(new URL("../extension/_locales/en/messages.json", import.meta.url)));
const zh = JSON.parse(readFileSync(new URL("../extension/_locales/zh_CN/messages.json", import.meta.url)));

test("both locales define exactly the same keys", () => {
	assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});
test("every message has a non-empty string", () => {
	for (const [k, v] of Object.entries({ ...en, ...zh })) {
		assert.equal(typeof v.message, "string", `${k} missing message`);
		assert.ok(v.message.length > 0, `${k} is empty`);
	}
});
test("placeholder counts match across locales", () => {
	for (const k of Object.keys(en)) {
		const count = (s) => (s.match(/\$\d/g) || []).length;
		assert.equal(count(en[k].message), count(zh[k].message), `${k} placeholder mismatch`);
	}
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/i18n.test.mjs`
Expected: FAIL — `_locales` 文件不存在

- [ ] **Step 3: 建两份 messages.json**

`extension/_locales/zh_CN/messages.json`：

```json
{
  "extName":            { "message": "灵感 Clipper" },
  "extDescription":     { "message": "框选或右键，一键把灵感存进你已经在用的笔记。" },
  "actionTitle":        { "message": "灵感 Clipper：框选截图" },
  "cmdCaptureRegion":   { "message": "框选截图存入灵感库" },
  "dest_obsidian":      { "message": "Obsidian" },
  "dest_notion":        { "message": "Notion" },
  "okSaved":            { "message": "已存入 $1 ✓", "placeholders": { "dest": { "content": "$1" } } },
  "okSavedDegraded":    { "message": "文件较大，已改存 $1（$2 装不下）", "placeholders": { "to": { "content": "$1" }, "from": { "content": "$2" } } },
  "errNoDestination":   { "message": "还没设置存到哪儿，点扩展图标去配置" },
  "errTooLarge":        { "message": "这个文件 $1 MB，所有目的地最大只支持 $2 MB，没存上", "placeholders": { "size": { "content": "$1" }, "max": { "content": "$2" } } },
  "errObsidianClosed":  { "message": "Obsidian 没开，或者没打开 Local REST API 的 HTTP 端口" },
  "errObsidianKey":     { "message": "Obsidian 的连接钥匙对不上，去配置页重新粘一次" },
  "errObsidianGeneric": { "message": "存进 Obsidian 失败，重试一下" },
  "errSidecarFailed":   { "message": "图存上了，但来源信息没写进去" },
  "errNotionUnconfigured": { "message": "Notion 还没配好，去配置页填 token 和数据库" },
  "errNotionToken":     { "message": "Notion 的 token 无效或已过期" },
  "errNotionUnreachable": { "message": "连不上 Notion，检查一下网络" },
  "errNotionUploadFailed": { "message": "文件传到一半失败了，重试一下" },
  "errNotionPageFailed": { "message": "文件传上去了，但没能建成条目" },
  "errNotionGeneric":   { "message": "存进 Notion 失败，重试一下" },
  "errGeneric":         { "message": "没存上，重试一下；连续失败请点扩展图标看状态" }
}
```

`extension/_locales/en/messages.json` —— key 完全一致，`message` 换成英文，`placeholders` 结构原样保留。例如：

```json
{
  "extName":            { "message": "Inspiration Clipper" },
  "extDescription":     { "message": "Drag-select or right-click to save inspiration into the notes app you already use." },
  "actionTitle":        { "message": "Inspiration Clipper: capture a region" },
  "cmdCaptureRegion":   { "message": "Capture a region into your library" },
  "dest_obsidian":      { "message": "Obsidian" },
  "dest_notion":        { "message": "Notion" },
  "okSaved":            { "message": "Saved to $1 ✓", "placeholders": { "dest": { "content": "$1" } } },
  "okSavedDegraded":    { "message": "Too large for $2 — saved to $1 instead", "placeholders": { "to": { "content": "$1" }, "from": { "content": "$2" } } },
  "errNoDestination":   { "message": "No destination set yet — click the extension icon to configure one" },
  "errTooLarge":        { "message": "This file is $1 MB; the largest destination takes $2 MB. Not saved.", "placeholders": { "size": { "content": "$1" }, "max": { "content": "$2" } } },
  "errObsidianClosed":  { "message": "Obsidian isn't running, or the Local REST API HTTP port isn't enabled" },
  "errObsidianKey":     { "message": "Obsidian API key doesn't match — paste it again in settings" },
  "errObsidianGeneric": { "message": "Couldn't save to Obsidian. Try again." },
  "errSidecarFailed":   { "message": "Image saved, but the source metadata didn't get written" },
  "errNotionUnconfigured": { "message": "Notion isn't set up yet — add a token and database in settings" },
  "errNotionToken":     { "message": "Notion token is invalid or expired" },
  "errNotionUnreachable": { "message": "Can't reach Notion — check your connection" },
  "errNotionUploadFailed": { "message": "The upload failed partway through. Try again." },
  "errNotionPageFailed": { "message": "The file uploaded but the entry couldn't be created" },
  "errNotionGeneric":   { "message": "Couldn't save to Notion. Try again." },
  "errGeneric":         { "message": "Not saved. Try again; if it keeps failing, click the extension icon." }
}
```

`extension/lib/i18n.js`：

```js
// extension/lib/i18n.js — chrome.i18n 薄包装。测试环境无 chrome 时回退到 key 本身，
// 让纯函数测试不必 stub 整个 chrome 命名空间。
export function t(key, substitutions) {
	if (typeof chrome !== "undefined" && chrome.i18n) {
		return chrome.i18n.getMessage(key, substitutions) || key;
	}
	return key;
}
```

- [ ] **Step 4: manifest 与 background 的中文全部替换**

`extension/manifest.json` 加 `"default_locale": "zh_CN"`，并把四处硬编码改为 `__MSG_` 形式：

```json
"name": "__MSG_extName__",
"description": "__MSG_extDescription__",
"action": { "default_title": "__MSG_actionTitle__", "default_popup": "popup/popup.html" },
"commands": { "capture-region": { "suggested_key": { "default": "Alt+Shift+S" }, "description": "__MSG_cmdCaptureRegion__" } },
"options_page": "options/options.html"
```

`extension/background.js` 中所有 `showToast(..., "中文字面量", ...)` 改为 `showToast(..., t("key"), ...)`。共 11 处（截图配额、保护页、注入失败、无 srcUrl、blob 流媒体、内嵌图不支持、认不出格式 ×2、地址不认识、无权限、太大、防盗链）。为这批新增对应的 `capture*` key，两个 locale 同步添加。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tests/`
Expected: PASS —— 特别是 key 一致性与 placeholder 数量一致

- [ ] **Step 6: 手动验证语言切换**

1. Chrome 语言设为 English → 重载扩展 → toast 与扩展名为英文
2. 切回中文 → 重载 → 恢复中文
3. 触发一次降级（>5MB 的 GIF）→ 两种语言下数值占位符都正确填入

- [ ] **Step 7: 提交**

```bash
git add extension/_locales extension/lib/i18n.js extension/manifest.json extension/background.js tests/i18n.test.mjs
git commit -m "feat: zh/en localization for all user-facing strings

Key parity and placeholder-count parity are enforced by tests, so a
half-translated locale fails CI rather than shipping as silent fallback."
```

---

## Task 7: 配置页与多目的地状态卡

**Files:**
- Create: `extension/options/options.html`
- Create: `extension/options/options.js`
- Modify: `extension/popup/popup.js`、`extension/popup/popup.html`

**Interfaces:**
- Consumes: Task 4 `loadSettings` / `saveSettings`、各 adapter 的 `test()`
- Produces: 无（终端 UI）

- [ ] **Step 1: 建 options 页骨架**

`extension/options/options.html`：两个 fieldset（Obsidian / Notion），字段分别为 `port` / `apiKey` / `folder` 与 `token` / `databaseId`；一个目的地优先级的排序控件（两个下拉：首选 / 备选）；一个「测试连接」按钮，每个 fieldset 各一个状态灯。所有可见文案通过 `data-i18n` 属性标注，由 `options.js` 在 `DOMContentLoaded` 时用 `t()` 填充。

- [ ] **Step 2: options.js 读写配置**

```js
import { loadSettings, saveSettings } from "../lib/settings.js";
import { ADAPTERS } from "../lib/adapters/index.js";
import { t } from "../lib/i18n.js";

document.querySelectorAll("[data-i18n]").forEach((el) => {
	el.textContent = t(el.dataset.i18n);
});

const form = document.querySelector("form");
const s = await loadSettings();
// 回填
form.port.value = s.byAdapter.obsidian.port;
form.apiKey.value = s.byAdapter.obsidian.apiKey;
form.folder.value = s.byAdapter.obsidian.folder;
form.token.value = s.byAdapter.notion.token;
form.databaseId.value = s.byAdapter.notion.databaseId;
form.primary.value = s.chain[0] ?? "";
form.fallback.value = s.chain[1] ?? "";

form.addEventListener("submit", async (e) => {
	e.preventDefault();
	const chain = [form.primary.value, form.fallback.value].filter(Boolean);
	await saveSettings({
		chain: [...new Set(chain)],
		byAdapter: {
			obsidian: { port: Number(form.port.value) || 27123, apiKey: form.apiKey.value.trim(), folder: form.folder.value.trim() || "灵感库" },
			notion: { token: form.token.value.trim(), databaseId: form.databaseId.value.trim() },
		},
	});
	document.querySelector("#saved").textContent = t("optSaved");
});

document.querySelectorAll("[data-test-adapter]").forEach((btn) => {
	btn.addEventListener("click", async () => {
		const id = btn.dataset.testAdapter;
		const cur = await loadSettings();
		const r = await ADAPTERS[id].test(cur.byAdapter[id]);
		const light = document.querySelector(`#status-${id}`);
		light.textContent = r.ok ? t("optConnected") : t(r.errorKey ?? "errGeneric");
		light.className = r.ok ? "ok" : "bad";
	});
});
```

- [ ] **Step 3: popup 状态卡显示每个目的地**

`extension/popup/popup.js` 改为遍历 `settings.chain`，对每个 adapter 调 `test()`，各显示一行「名称 + 红/绿灯 + 人话指引」。未配置任何目的地时，显示一句提示与一个跳转 options 的按钮（`chrome.runtime.openOptionsPage()`）。

- [ ] **Step 4: 手动验证**

1. 右键扩展图标 → 选项 → 填 Obsidian 与 Notion 两组配置 → 保存
2. 各点一次「测试连接」→ 期望两个绿灯
3. 故意把 Notion token 改错 → 测试 → 期望显示"token 无效"而不是通用错误
4. 关掉 Obsidian → 点扩展图标 → 期望状态卡里 Obsidian 是红灯且文案说明怎么办
5. 清空目的地配置 → 截图 → 期望 toast 提示"还没设置存到哪儿"

- [ ] **Step 5: 提交**

```bash
git add extension/options extension/popup extension/manifest.json
git commit -m "feat: options page and multi-destination status card

Each adapter reports its own failure reason, so 'Obsidian is closed' and
'wrong Notion token' are distinguishable at a glance rather than both
surfacing as a generic red light."
```

---

## Self-Review

**Spec coverage**

| Spec 要求 | 对应任务 |
|---|---|
| 捕获层不改，抽 `CaptureItem` | Task 1 |
| `capabilities()` 动态实探 | Task 5（Notion 读 `workspace_limits`）、Task 3（Obsidian 恒 `Infinity`） |
| 捕获层不知道 adapter 存在 | Task 4（`saveToLibrary` 只与 router 对话） |
| 降级策略住路由层 | Task 2 |
| ObsidianAdapter（Local REST API） | Task 3 |
| NotionAdapter（三步上传） | Task 5 |
| 降级链 Notion→Obsidian | Task 2 + Task 5 Step 5 验证 |
| i18n 中英双语 | Task 6 |
| 不静默失败 | Task 4（每条错误路径都有 toast）+ Task 6（每个 errorKey 都有文案） |
| 零服务器 | 全程只有 localhost 与 Notion 官方 API |
| 不用 FSA API | 未出现 |

**未覆盖（已知，属本计划范围外）**

- 组件 4 的**接入引导文案**（Notion 模板数据库本体已建成，见 spec）——建议并入将来的模板打磨任务
- 组件 6 **iOS 快捷指令模板** —— 独立交付物，依赖 Task 5 的字段结构定稿，另开计划
- **Firefox 适配** —— 独立交付物，另开计划

**Placeholder scan：** 无 TBD / TODO。唯一一处不确定（Notion 属性挂载的 JSON）已在 Task 5 Step 1 明确为"先查文档核对"，并给出待验证的具体形状与文档地址，不是模糊指示。

**Type consistency：** `CaptureItem` 字段（`base64/ext/mime/filename/title/sourceTitle/sourceUrl/capturedAt/byteLength`）在 Task 1 定义，Task 3、4、5 使用一致。`chooseDestination` 返回 `{adapterId, degradedFrom}` 或 `{error, …}`，Task 4 两个分支都处理了。adapter 四方法（`id/test/capabilities/save`）在 Task 3 定下，Task 5 完全遵循。`errorKey` 在 adapter 里抛出、在 Task 6 的 locale 里全部有对应条目（已逐条比对）。

**一处需要实现者留意的行为变更：** `saveToLibrary` 的参数名从 `imageBase64` 改为 `base64`，且新增必填的 `ext`。Task 4 Step 5 已列出三个调用点，漏改会导致 `undefined` 静默传到 adapter。
