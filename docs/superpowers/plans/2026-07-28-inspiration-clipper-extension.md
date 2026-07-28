# 灵感 Clipper Chrome 扩展 Implementation Plan（计划 2/3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome MV3 扩展：快捷键/工具栏 → 区域框选截图，右键图片 → 原图入库，全部零弹窗自动 POST 到 Media Companion fork（`localhost:27124`）落进 creation-flywheel 的 `灵感库/`。

**Architecture:** 扩展住在本仓库 `extension/`，plain JS ES modules、无构建步骤（同 Visual Clipper 惯例）。区域框选 overlay 从 Visual Clipper `content.js` 移植（先 captureVisibleTab 再画遮罩，遮罩不进图）；上传协议对接 Media Companion 的 `POST /api/upload`（字段 `imageBase64/filename/folder/tags/sourceUrl/sourceTitle`，Bearer 鉴权）。API key 由安装脚本在用户机器上生成并直写两端，永不回显。

**Tech Stack:** Chrome Manifest V3 / plain JS ES modules / `node --test`（纯函数测试，零依赖）。

## Global Constraints

- **key 纪律**：任何命令、日志、报告、commit 均不得输出 API key 的值；生成与写入必须在同一条不回显的命令里完成
- 用户可见文案**中文单语**（个人工具；产品化 i18n 记录在案不做）
- 权限最小化：`permissions` 仅 `["contextMenus", "activeTab", "scripting", "storage"]`；**不**声明 `host_permissions`；原图抓取用 `optional_host_permissions: ["<all_urls>"]` 按域名在用户手势中申请
- `extension/config.local.js` 进 `.gitignore`（含 key），仓库只跟踪 `config.local.example.js`
- 交互铁律：截图主路径零弹窗、零选择；所有失败必须有中文 toast，绝不静默
- 每个任务结束 commit；实现与测试文件分开 commit 不强制（本扩展不进上游 PR）
- 仓库根：`/Users/liyachen/Documents/fang/inspiration-clipper`；vault：`/Users/liyachen/Documents/creation-flywheel`

---

### Task 1: 脚手架（manifest + 目录 + 测试底座）

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/config.local.example.js`
- Create: `extension/lib/helpers.js`（空壳，Task 3 填充）
- Create: `tests/helpers.test.mjs`（smoke）
- Create: `.gitignore`（追加）

**Interfaces:**
- Produces: 可被 Chrome load-unpacked 识别的扩展骨架；`node --test` 可运行

- [ ] **Step 1: 写 manifest.json**

```json
{
	"manifest_version": 3,
	"name": "灵感 Clipper",
	"version": "0.1.0",
	"description": "框选或右键，一键把灵感存进 Obsidian 灵感库。",
	"permissions": ["contextMenus", "activeTab", "scripting", "storage"],
	"optional_host_permissions": ["<all_urls>"],
	"background": { "service_worker": "background.js", "type": "module" },
	"action": { "default_title": "灵感 Clipper：框选截图", "default_popup": "popup/popup.html" },
	"commands": {
		"capture-region": {
			"suggested_key": { "default": "Alt+Shift+S" },
			"description": "框选截图存入灵感库"
		}
	},
	"icons": { "128": "icon128.png" }
}
```

- [ ] **Step 2: 生成占位图标**

```bash
cd /Users/liyachen/Documents/fang/inspiration-clipper/extension && python3 -c "
from PIL import Image, ImageDraw
img = Image.new('RGB', (128, 128), (99, 102, 241))
d = ImageDraw.Draw(img)
d.rectangle([28, 28, 100, 100], outline=(255, 255, 255), width=8)
img.save('icon128.png')
"
```

- [ ] **Step 3: config 样例 + gitignore**

```js
// extension/config.local.example.js — 复制为 config.local.js 并由 scripts/setup-key.sh 填充
export const LOCAL = {
	port: 27124,
	apiKey: "",
	folder: "灵感库",
};
```

`.gitignore` 追加一行：`extension/config.local.js`

- [ ] **Step 4: helpers 空壳 + smoke test**

```js
// extension/lib/helpers.js — 纯函数集合（Task 3 填充）
export const HELPERS_READY = true;
```

```js
// tests/helpers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { HELPERS_READY } from "../extension/lib/helpers.js";

test("test infra runs", () => {
	assert.equal(HELPERS_READY, true);
});
```

- [ ] **Step 5: 运行验证 + commit**

Run: `cd /Users/liyachen/Documents/fang/inspiration-clipper && node --test`
Expected: 1 pass。

```bash
git add extension .gitignore tests
git commit -m "feat: extension scaffold (MV3 manifest, config example, test infra)"
```

---

### Task 2: setup-key 脚本（key 生成直写两端，永不回显）

**Files:**
- Create: `scripts/setup-key.sh`
- Modify: `/Users/liyachen/Documents/creation-flywheel/.obsidian/plugins/media-companion/data.json`（脚本运行时）
- Create: `extension/config.local.js`（脚本运行时，gitignored）

**Interfaces:**
- Consumes: Task 1 的 `config.local.example.js` 结构
- Produces: 两端持有同一 key；插件 `apiEnabled: true`；脚本幂等（重跑重新配对）

- [ ] **Step 1: 写脚本**

```bash
#!/bin/bash
# scripts/setup-key.sh — 在本机生成 API key 并写入插件与扩展两端。
# 输出只有 ok/错误，key 值永不回显、不进日志。
set -euo pipefail

VAULT_DATA="/Users/liyachen/Documents/creation-flywheel/.obsidian/plugins/media-companion/data.json"
EXT_CONFIG="$(cd "$(dirname "$0")/.." && pwd)/extension/config.local.js"

KEY=$(openssl rand -hex 32)

KEY="$KEY" VAULT_DATA="$VAULT_DATA" python3 - <<'PY'
import json, os
path = os.environ["VAULT_DATA"]
with open(path) as f:
    data = json.load(f)
data["apiKey"] = os.environ["KEY"]
data["apiEnabled"] = True
with open(path, "w") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
PY

cat > "$EXT_CONFIG" <<EOF
// 自动生成：scripts/setup-key.sh。不进 git。
export const LOCAL = {
	port: 27124,
	apiKey: "$KEY",
	folder: "灵感库",
};
EOF

echo "ok: key written to plugin data.json and extension config.local.js"
```

- [ ] **Step 2: 运行 + 验证（不读 key）**

```bash
chmod +x scripts/setup-key.sh && ./scripts/setup-key.sh
python3 -c "import json;d=json.load(open('/Users/liyachen/Documents/creation-flywheel/.obsidian/plugins/media-companion/data.json'));print('apiEnabled:',d['apiEnabled'],'| key set:',bool(d['apiKey']),'| key printed: NO')"
test -f extension/config.local.js && echo "config.local.js exists" && grep -c apiKey extension/config.local.js
```

Expected: `apiEnabled: True | key set: True`；config 存在。**任何一步都不 cat key 内容。**

- [ ] **Step 3: 请用户重载插件后，验证鉴权生效**

请用户：creation-flywheel 设置 → Community plugins → Media Companion 关再开（重载读取新设置）。然后：

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:27124/api/folders
```

Expected: **401**（无 key 被拒 = 锁生效）。若 000 = 服务器没起来（用户未重载或 API 未启用），排查后重试。

- [ ] **Step 4: Commit（只有脚本进 git）**

```bash
git add scripts/setup-key.sh
git commit -m "feat: setup-key script wires API key into both ends without echoing it"
```

---

### Task 3: 纯函数 helpers（TDD）

**Files:**
- Modify: `extension/lib/helpers.js`
- Test: `tests/helpers.test.mjs`（替换 smoke）

**Interfaces:**
- Produces（后续任务按此签名消费）:
  - `sanitizeTitle(title: string): string` — 去 `/\:*?"<>|#[]` 与首尾空白，截 60 字符，空则 `"clip"`
  - `buildFilename(title: string, now: number): string` — `${sanitizeTitle(title)}-${now}.png`
  - `buildUploadBody(o: {imageBase64, title, sourceUrl, folder, now}): object` — 返回 `{imageBase64, filename, folder, tags: [], sourceUrl, sourceTitle}` 完整上传体
  - `friendlyError(e: {status?: number, networkError?: boolean}): string` — 网络不通 → `"Obsidian（creation-flywheel）没开，这张没存上"`；401 → `"连接钥匙对不上，重跑 setup-key 脚本试试"`；其余 → `"没存上，重试一下；连续失败请点扩展图标看状态"`

- [ ] **Step 1: 写失败测试**

```js
// tests/helpers.test.mjs
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
```

- [ ] **Step 2: 确认失败** — Run: `node --test` → FAIL（导出不存在）

- [ ] **Step 3: 实现**

```js
// extension/lib/helpers.js — 纯函数，无 chrome API，可被 node --test 直接测
export function sanitizeTitle(title) {
	const cleaned = (title || "").replace(/[/\\:*?"<>|#[\]]/g, "").trim().slice(0, 60);
	return cleaned || "clip";
}

export function buildFilename(title, now) {
	return `${sanitizeTitle(title)}-${now}.png`;
}

export function buildUploadBody({ imageBase64, title, sourceUrl, folder, now }) {
	return {
		imageBase64,
		filename: buildFilename(title, now),
		folder,
		tags: [],
		sourceUrl,
		sourceTitle: sanitizeTitle(title),
	};
}

export function friendlyError(e) {
	if (e && e.networkError) return "Obsidian（creation-flywheel）没开，这张没存上";
	if (e && e.status === 401) return "连接钥匙对不上，重跑 setup-key 脚本试试";
	return "没存上，重试一下；连续失败请点扩展图标看状态";
}
```

- [ ] **Step 4: 确认通过 + commit**

Run: `node --test` → 8 pass。

```bash
git add extension/lib/helpers.js tests/helpers.test.mjs
git commit -m "feat: pure helpers (filename, upload body, friendly errors) with tests"
```

---

### Task 4: background 上传客户端 + toast 通道

**Files:**
- Create: `extension/background.js`
- Create: `extension/lib/upload.js`
- Create: `extension/content-toast.js`

**Interfaces:**
- Consumes: Task 3 helpers；Task 2 的 `config.local.js`
- Produces:
  - `upload(body): Promise<void>` — POST `http://localhost:{port}/api/upload`，Bearer key，非 2xx 抛 `{status}`，网络异常抛 `{networkError: true}`
  - SW 内 `showToast(tabId, text, ok)` — 注入 `content-toast.js` 后发 `{action:"inspToast", text, ok}`
  - background 骨架：注册 command / action / contextMenu 监听（本任务先接 toast 与上传，捕获流 Task 5/6 填）

- [ ] **Step 1: upload.js**

```js
// extension/lib/upload.js
import { LOCAL } from "../config.local.js";

export async function upload(body) {
	let res;
	try {
		res = await fetch(`http://localhost:${LOCAL.port}/api/upload`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(LOCAL.apiKey ? { Authorization: `Bearer ${LOCAL.apiKey}` } : {}),
			},
			body: JSON.stringify(body),
		});
	} catch (e) {
		throw { networkError: true };
	}
	if (!res.ok) throw { status: res.status };
}

export async function ping() {
	try {
		const res = await fetch(`http://localhost:${LOCAL.port}/api/ping`, {
			headers: LOCAL.apiKey ? { Authorization: `Bearer ${LOCAL.apiKey}` } : {},
		});
		return res.ok;
	} catch {
		return false;
	}
}
```

- [ ] **Step 2: content-toast.js（按需注入）**

```js
// extension/content-toast.js — 右下角 toast，2.4s 自动消失
(function () {
	if (window.__INSP_TOAST_BOUND__) return;
	window.__INSP_TOAST_BOUND__ = true;
	chrome.runtime.onMessage.addListener((msg) => {
		if (msg?.action !== "inspToast") return;
		document.getElementById("insp-toast")?.remove();
		const el = document.createElement("div");
		el.id = "insp-toast";
		el.textContent = msg.text;
		el.style.cssText =
			"position:fixed;right:20px;bottom:20px;z-index:2147483647;" +
			`background:${msg.ok ? "rgba(22,163,74,.94)" : "rgba(220,38,38,.94)"};` +
			"color:#fff;padding:10px 18px;border-radius:10px;" +
			"font:14px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);";
		document.body.appendChild(el);
		setTimeout(() => el.remove(), 2400);
	});
})();
```

- [ ] **Step 3: background.js 骨架**

```js
// extension/background.js — 路由：快捷键/图标 → 截图流；右键 → 原图流
import { upload, ping } from "./lib/upload.js";
import { buildUploadBody, friendlyError } from "./lib/helpers.js";
import { LOCAL } from "./config.local.js";

export async function showToast(tabId, text, ok) {
	try {
		await chrome.scripting.executeScript({ target: { tabId }, files: ["content-toast.js"] });
		await chrome.tabs.sendMessage(tabId, { action: "inspToast", text, ok });
	} catch (e) {
		console.warn("[insp] toast failed:", e);
	}
}

export async function saveToLibrary(tabId, { imageBase64, title, sourceUrl }) {
	try {
		await upload(buildUploadBody({ imageBase64, title, sourceUrl, folder: LOCAL.folder, now: Date.now() }));
		await showToast(tabId, "已存入灵感库 ✓", true);
	} catch (e) {
		await showToast(tabId, friendlyError(e), false);
	}
}

// popup 状态查询
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.action === "inspPing") {
		ping().then((ok) => sendResponse({ ok }));
		return true;
	}
});
```

- [ ] **Step 4: 验证 + commit**

Run: `node --test`（helpers 不回归）+ `node --check extension/background.js extension/lib/upload.js extension/content-toast.js`
Expected: 全通过（`node --check` 用 `for f in ...; do node --check $f; done` 逐个跑）。

```bash
git add extension/background.js extension/lib/upload.js extension/content-toast.js
git commit -m "feat: upload client, toast channel, background skeleton"
```

---

### Task 5: 区域框选截图流（主路径）

**Files:**
- Create: `extension/content-overlay.js`（从 Visual Clipper `extension/content.js` 1-141 行移植改造）
- Modify: `extension/background.js`（接 command/action + regionSelected + crop）

**Interfaces:**
- Consumes: Task 4 的 `saveToLibrary` / `showToast`
- Produces: 完整链路：快捷键或图标 → captureVisibleTab → 注入 overlay（带 dataUrl）→ 用户拖框 → `{action:"inspRegionSelected", rect, dpr, source_url, title, dataUrl}` → SW crop → 上传 → overlay 收尾 toast

- [ ] **Step 1: content-overlay.js**

移植来源：`/Users/liyachen/Documents/fang/screenshot-clipper/extension/content.js` 的 `show/draw/remove/onDown/onMove/onUp/onKey`（1-141 行）。改造点（其余逐行照抄）：

1. 守卫标志改名：`__SC_BOUND__` → `__INSP_OVERLAY_BOUND__`；`__SC_OVERLAY_ACTIVE__` → `__INSP_OVERLAY_ACTIVE__`
2. 文案硬编码中文（无 i18n）：拖拽提示 `"拖动框选要收藏的区域，Esc 取消"`；保存中 `"保存中…"`；超时 `"超时了，重试一下"`
3. `onUp` 里发送的消息 `action` 改为 `"inspRegionSelected"`，其余字段（rect/dpr/source_url/title/dataUrl）保持原样
4. 安全定时器从 120000ms 改为 15000ms（本地上传，15 秒不回来就是失败）
5. 消息监听只保留两个 case：`{action:"inspShowOverlay", dataUrl}` → `show(dataUrl)`；`{action:"inspCaptureDone"}` → `remove()`（成功失败都由 background 的 toast 说话，overlay 只负责消失）

完整文件结构：

```js
// extension/content-overlay.js — 区域框选遮罩（移植自 Visual Clipper content.js）
(function () {
	if (window.__INSP_OVERLAY_BOUND__) return;
	window.__INSP_OVERLAY_BOUND__ = true;

	let overlay, canvas, ctx, hint;
	let state = "idle";
	let startX = 0, startY = 0, endX = 0, endY = 0;
	let pendingDataUrl = null;

	// …… show()/draw()/remove()/onDown()/onMove() 按上述改造点从来源文件逐行移植 ……

	function onUp(e) {
		if (state !== "selecting") return;
		endX = e.clientX; endY = e.clientY;
		const x = Math.min(startX, endX), y = Math.min(startY, endY);
		const w = Math.abs(endX - startX), h = Math.abs(endY - startY);
		if (w < 10 || h < 10) { state = "idle"; draw(); return; }
		state = "processing";
		hint.textContent = "保存中…";
		const safetyTimer = setTimeout(() => {
			if (state === "processing") { state = "idle"; hint.textContent = "超时了，重试一下"; hint.style.background = "rgba(239,68,68,.85)"; }
		}, 15000);
		chrome.runtime.sendMessage({
			action: "inspRegionSelected",
			rect: { x, y, width: w, height: h },
			dpr: window.devicePixelRatio || 1,
			source_url: location.href,
			title: document.title,
			dataUrl: pendingDataUrl,
		}, () => clearTimeout(safetyTimer));
	}

	chrome.runtime.onMessage.addListener((msg) => {
		if (msg?.action === "inspShowOverlay") show(msg.dataUrl);
		if (msg?.action === "inspCaptureDone") remove();
	});
})();
```

（`…… ……` 处为移植区，实施者从来源文件抄入并应用改造点 1-2；不留省略号在最终代码里。）

- [ ] **Step 2: background.js 接线**

追加：

```js
async function startRegionCapture(tab) {
	if (!tab?.id) return;
	let dataUrl;
	try {
		dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
	} catch (e) {
		await showToast(tab.id, "这个页面截不了图（浏览器保护页），换个页面试试", false);
		return;
	}
	await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-overlay.js"] });
	await chrome.tabs.sendMessage(tab.id, { action: "inspShowOverlay", dataUrl });
}

chrome.commands.onCommand.addListener(async (command, tab) => {
	if (command === "capture-region") await startRegionCapture(tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
});

// 图标点击也走截图（popup 存在时不触发 onClicked，故图标主入口是 popup；此处给无 popup 场景兜底）

async function cropImage(dataUrl, rect, dpr) {
	const blob = await (await fetch(dataUrl)).blob();
	const sx = Math.round(rect.x * dpr), sy = Math.round(rect.y * dpr);
	const sw = Math.round(rect.width * dpr), sh = Math.round(rect.height * dpr);
	const bitmap = await createImageBitmap(blob, sx, sy, sw, sh);
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	canvas.getContext("2d").drawImage(bitmap, 0, 0);
	const out = await canvas.convertToBlob({ type: "image/png" });
	const buf = await out.arrayBuffer();
	let bin = "";
	const bytes = new Uint8Array(buf);
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
	if (msg?.action !== "inspRegionSelected" || !sender.tab?.id) return;
	(async () => {
		const tabId = sender.tab.id;
		try {
			const b64 = await cropImage(msg.dataUrl, msg.rect, msg.dpr);
			await chrome.tabs.sendMessage(tabId, { action: "inspCaptureDone" });
			await saveToLibrary(tabId, { imageBase64: b64, title: msg.title, sourceUrl: msg.source_url });
		} catch (e) {
			await chrome.tabs.sendMessage(tabId, { action: "inspCaptureDone" }).catch(() => {});
			await showToast(tabId, "没存上，重试一下；连续失败请点扩展图标看状态", false);
		}
	})();
});
```

注意：popup 的「截图」按钮（Task 7）会发 `{action:"inspStartCapture"}` 给 background，同样落到 `startRegionCapture`——在上面的 onMessage 里加一个 case：

```js
	if (msg?.action === "inspStartCapture") {
		chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => startRegionCapture(tab));
	}
```

- [ ] **Step 3: 语法检查 + commit**

Run: `for f in extension/background.js extension/content-overlay.js; do node --check $f && echo "$f ok"; done`

```bash
git add extension/content-overlay.js extension/background.js
git commit -m "feat: region capture flow (overlay ported from Visual Clipper, crop in SW)"
```

---

### Task 6: 右键原图入库（副路径）

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `saveToLibrary` / `showToast`
- Produces: 图片右键菜单「存入灵感库」；首次遇到新图源域名时在用户手势里申请该域名权限；拿不到原图时人话降级

- [ ] **Step 1: 接线**

追加：

```js
chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: "insp-save-image",
		title: "存入灵感库",
		contexts: ["image"],
	});
});

async function fetchImageAsBase64(srcUrl) {
	const res = await fetch(srcUrl);
	if (!res.ok) throw { status: res.status };
	const buf = await res.arrayBuffer();
	let bin = "";
	const bytes = new Uint8Array(buf);
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
	if (info.menuItemId !== "insp-save-image" || !tab?.id || !info.srcUrl) return;
	(async () => {
		// data: URL 的图直接取，无需权限
		if (info.srcUrl.startsWith("data:")) {
			const b64 = info.srcUrl.split(",")[1] ?? "";
			await saveToLibrary(tab.id, { imageBase64: b64, title: tab.title ?? "clip", sourceUrl: info.pageUrl ?? "" });
			return;
		}
		// 用户手势窗口内申请该图源域名的权限（首次一问，之后静默）
		let origin;
		try {
			origin = new URL(info.srcUrl).origin + "/*";
		} catch {
			await showToast(tab.id, "这张图的地址不认识，用框选截图吧（Alt+Shift+S）", false);
			return;
		}
		const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
		if (!granted) {
			await showToast(tab.id, "没拿到读图权限，用框选截图吧（Alt+Shift+S）", false);
			return;
		}
		try {
			const b64 = await fetchImageAsBase64(info.srcUrl);
			await saveToLibrary(tab.id, { imageBase64: b64, title: tab.title ?? "clip", sourceUrl: info.pageUrl ?? info.srcUrl });
		} catch {
			await showToast(tab.id, "原图拿不到（站点防盗链），用框选截图吧（Alt+Shift+S）", false);
		}
	})();
});
```

- [ ] **Step 2: 语法检查 + commit**

Run: `node --check extension/background.js`

```bash
git add extension/background.js
git commit -m "feat: right-click original image capture with on-demand host permission"
```

---

### Task 7: popup 状态卡片

**Files:**
- Create: `extension/popup/popup.html`
- Create: `extension/popup/popup.js`

**Interfaces:**
- Consumes: background 的 `inspPing` / `inspStartCapture`
- Produces: 点图标 → 绿/红状态卡 + 「框选截图」按钮 + 快捷键提示；红灯给人话指引

- [ ] **Step 1: popup.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
	body { width: 260px; margin: 0; padding: 16px; font: 14px/1.6 system-ui, sans-serif; }
	.light { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
	.ok { background: #16a34a; } .bad { background: #dc2626; }
	#hint { color: #666; font-size: 12px; margin: 8px 0 12px; }
	button { width: 100%; padding: 10px; border: 0; border-radius: 8px; background: #6366f1; color: #fff; font-size: 14px; cursor: pointer; }
	button:disabled { background: #c7c9f5; }
	.kbd { color: #999; font-size: 12px; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
	<div><span id="light" class="light bad"></span><span id="status">检查连接中…</span></div>
	<div id="hint"></div>
	<button id="capture" disabled>框选截图</button>
	<div class="kbd">快捷键 Alt+Shift+S</div>
	<script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: popup.js**

```js
// extension/popup/popup.js
const light = document.getElementById("light");
const status = document.getElementById("status");
const hint = document.getElementById("hint");
const btn = document.getElementById("capture");

chrome.runtime.sendMessage({ action: "inspPing" }, (resp) => {
	if (resp?.ok) {
		light.className = "light ok";
		status.textContent = "已连接 Obsidian 灵感库";
		hint.textContent = "";
		btn.disabled = false;
	} else {
		light.className = "light bad";
		status.textContent = "连不上灵感库";
		hint.textContent = "打开 Obsidian 的 creation-flywheel 仓库就能用；开着还不行就重开一次 Media Companion 插件。";
	}
});

btn.addEventListener("click", () => {
	chrome.runtime.sendMessage({ action: "inspStartCapture" });
	window.close();
});
```

- [ ] **Step 3: 语法检查 + commit**

Run: `node --check extension/popup/popup.js`

```bash
git add extension/popup
git commit -m "feat: popup status card with connection light and capture button"
```

---

### Task 8: 端到端验收（用户参与）+ 收尾

**Files:** 无新代码（修 bug 除外）。

- [ ] **Step 1: 装进 Chrome**

请用户：`chrome://extensions` → 开发者模式 → Load unpacked → 选 `/Users/liyachen/Documents/fang/inspiration-clipper/extension` → 把图标钉到工具栏。

- [ ] **Step 2: 验收清单（对照 spec DoD）**

Obsidian（creation-flywheel）开着：
1. 点扩展图标 → 绿灯「已连接 Obsidian 灵感库」
2. 任意网页 Alt+Shift+S → 框选 → 绿 toast → `灵感库/` 出现 png + sidecar，sidecar 属性里有来源 URL（DoD 1）
3. Twitter/小红书右键一张图 →「存入灵感库」→（首次允许权限）→ 原图入库，分辨率 > 屏幕截图版（DoD 2）
4. `灵感库.base` 里新图出现在随机瀑布流
5. **退出 Obsidian** → 再框选 → 红 toast「Obsidian（creation-flywheel）没开，这张没存上」（DoD 5）；点图标 → 红灯 + 指引
6. 重开 Obsidian → 绿灯恢复

- [ ] **Step 3: 修出的 bug 走正常 fix 流程（复现 → 根因 → 修 → 回归），每修一个 commit 一次**

- [ ] **Step 4: 收尾 commit + 推送**

```bash
cd /Users/liyachen/Documents/fang/inspiration-clipper && git push origin master
cd /Users/liyachen/Documents/creation-flywheel && git add -A && git commit -m "chore: inspiration clipper e2e verified" || true
```

---

## Self-Review 记录

- Spec 覆盖：零配置预置（Task 2）、截图主路径零弹窗（Task 5）、右键原图（Task 6）、状态卡人话报错（Task 4/7）、DoD 1/2/5（Task 8）；DoD 3/4 已在计划 1 验收
- 类型一致：`saveToLibrary({imageBase64, title, sourceUrl})`、`inspRegionSelected` 消息字段、`LOCAL.{port,apiKey,folder}` 各任务引用一致
- 已知设计取舍（非占位符）：图标点击主入口是 popup（MV3 有 popup 时 action.onClicked 不触发），popup 里「框选截图」按钮即图标路径；快捷键是无 UI 直达路径
- 记录在案不做：配对流程（产品化）、离线排队、截图编辑、i18n、Firefox 版
