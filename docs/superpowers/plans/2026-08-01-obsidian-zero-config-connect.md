# Obsidian 零配置连接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Media Companion fork 的本地 API 默认开启;扩展向导 Obsidian 第 2 步从"填 Key + 手动测试"改为自动轮询检测,端口/Key 收进折叠高级区并附风险原理说明。

**Architecture:** 两个仓库各一次独立提交。fork 侧只改默认值 + 设置面板文案(风险知情是方案成立的前提,必做)。扩展侧照搬 Notion N2 已有的 4 秒轮询模式,复用共享的 `pollTimer`/`stopPolling` 基建,`show()` 离开步骤时自动停轮询的机制已存在,无需新增。

**Tech Stack:** Obsidian 插件 (TypeScript + esbuild + vitest);浏览器扩展 (vanilla JS ES modules + node:test)。

## Global Constraints

- 扩展测试命令必须用 glob:`node --test tests/*.test.mjs`(node:test 不认目录,历史教训)
- i18n 两个 locale (`zh_CN`/`en`) 键集合必须完全一致(i18n.test.mjs 强制 deepEqual)
- 用户红线:不可见的自动操作必须配可见的知情说明——fork 默认开 API 的同时,设置面板必须有原理/风险文案
- 提交信息用英文 conventional commits;每个 Task 一次提交
- 已有用户注意:曾保存过任意设置的老用户,`apiEnabled: false` 已落盘,改默认值对他们不生效——向导的等待文案必须包含"旧版/手动开开关"的指引(Task 2 文案已含)

---

### Task 1: Media Companion — API 默认开启 + 设置面板知情文案 + 版本号

**仓库:** `/Users/liyachen/Documents/fang/obsidian-media-companion`(注意:不是本仓库,cd 过去操作)

**Files:**
- Modify: `src/settings.ts:33`
- Modify: `main.ts:193-212`(Browser Extension API 区块)
- Modify: `manifest.json`(version 1.2.2 → 1.3.0)、`package.json`(version 同步)、`versions.json`(加一行)

**Interfaces:**
- Produces: 默认 `apiEnabled: true` 的插件构建产物;扩展侧 Task 2 的"自动连上"体验依赖它

- [ ] **Step 1: 改默认值**

`src/settings.ts` 第 33 行:

```ts
	apiEnabled: true,
```

(原为 `apiEnabled: false,`,仅改这一行)

- [ ] **Step 2: 设置面板加知情段落、更新开关描述**

`main.ts` 中找到:

```ts
		containerEl.createEl('h3', { text: 'Browser Extension API' });
```

紧随其后插入(在 `if (!Platform.isDesktopApp)` 之前):

```ts
		containerEl.createEl('p', {
			text: 'Lets the Inspiration Clipper browser extension save clips into this vault. '
				+ 'The server listens on 127.0.0.1 only — nothing is reachable from the network, '
				+ 'but other apps on this computer could call it. Set an API key below to lock it '
				+ 'down, or turn this off if you don\'t use the extension.',
			cls: 'setting-item-description',
		});
```

同一文件,`Enable API server` 那个 Setting 的描述改为:

```ts
			.setDesc('On by default so the browser extension works out of the box. Desktop only.')
```

(原文为 `'Start a local HTTP server so the browser extension can communicate with this plugin. Desktop only.'`)

- [ ] **Step 3: 版本号**

- `manifest.json`: `"version": "1.2.2"` → `"1.3.0"`
- `package.json`: version 字段同步为 `1.3.0`
- `versions.json`: 追加 `"1.3.0": "1.11.5"`(格式与已有条目一致,minAppVersion 抄 manifest.json 的 `1.11.5`)

- [ ] **Step 4: 测试 + 构建验证**

Run: `cd /Users/liyachen/Documents/fang/obsidian-media-companion && npm test && npm run build`
Expected: vitest 全绿;tsc + esbuild 无报错,产出 `main.js`

- [ ] **Step 5: Commit(在 obsidian-media-companion 仓库)**

```bash
git add src/settings.ts main.ts manifest.json package.json versions.json
git commit -m "feat: enable local API by default with informed-consent copy in settings

The wizard's zero-config Obsidian flow depends on the API being on out of
the box. Settings tab now explains what the port is, its loopback-only
scope, the local-process risk, and how to lock down (API key) or opt out."
```

---

### Task 2: 扩展向导 — O2 改自动检测 + 高级折叠区 + i18n

**仓库:** `/Users/liyachen/Documents/fang/inspiration-clipper`

**Files:**
- Modify: `extension/options/options.html:206-227`(O2 section 整块替换)
- Modify: `extension/options/options.js:147-164`(O2 逻辑整块替换)
- Modify: `extension/_locales/zh_CN/messages.json`、`extension/_locales/en/messages.json`
- Test: `tests/i18n.test.mjs`(现有用例即回归门禁,无需新增)

**Interfaces:**
- Consumes: `ADAPTERS.obsidian.test(cfg)` → `{ ok } | { ok: false, errorKey }`(errorKey 取值 `errObsidianClosed` / `errObsidianKey` / `errObsidianGeneric`,见 `extension/lib/adapters/obsidian.js`);共享轮询基建 `pollTimer` / `stopPolling()`(options.js:22,35-40);`show()` 离开步骤自动 `stopPolling()`(options.js:66)
- Produces: 元素 id 不变(`#apiKey` `#port` `#ob-next`),启动预填逻辑(options.js:109-110)无需改;新增 `#ob-detect-status`;删除 `#ob-test` `#ob-test-status`

- [ ] **Step 1: 替换 options.html 的 O2 section**

将 `<!-- Obsidian O2:开 API、粘 key、测试 -->` 到该 `</section>`(现 206-227 行)整块替换为:

```html
	<!-- Obsidian O2:自动检测连接(新版插件默认开 API;端口/Key 在高级折叠区) -->
	<section data-step="obsidian-connect" hidden>
		<h2 data-i18n="wizObConnectTitle"></h2>
		<p class="intro" data-i18n="wizObConnectIntro"></p>
		<div class="inline-status" id="ob-detect-status"></div>
		<details>
			<summary data-i18n="wizObAdvanced"></summary>
			<p class="muted" data-i18n="wizObAdvancedNote"></p>
			<label for="apiKey" data-i18n="wizObKeyLabel"></label>
			<input id="apiKey" type="password" autocomplete="off">
			<label for="port" data-i18n="optPort"></label>
			<input id="port" type="number" min="0" max="65535" value="27124">
		</details>
		<div class="nav">
			<button type="button" class="btn primary" id="ob-next" data-nav="next" data-i18n="wizNext" disabled></button>
		</div>
	</section>
```

- [ ] **Step 2: 替换 options.js 的 O2 逻辑**

将 `// —— Obsidian O2:测试连接门禁 ——` 到 `}`(现 147-164 行,含 `#ob-test` 点击与 input 失效监听)整块替换为:

```js
// —— Obsidian O2:自动检测连接。新版插件默认开 API,用户只要开着 Obsidian;
// 连不上就带着指引继续等(旧版插件要手动开开关,等待文案里已说)。 ——
const obNext = $("#ob-next");
const obDetectStatus = () => $("#ob-detect-status");

async function runObDetect() {
	const r = await ADAPTERS.obsidian.test(obsidianCfg());
	if (r.ok) {
		stopPolling();
		setStatus(obDetectStatus(), "ok", t("optConnected"));
		obNext.disabled = false;
	} else if (r.errorKey === "errObsidianKey") {
		// Key 对不上是明确错误,标红;但插件侧改对了就该自动恢复,轮询不停
		setStatus(obDetectStatus(), "bad", t("errObsidianKey"));
		obNext.disabled = true;
	} else {
		setStatus(obDetectStatus(), "", t("wizObDetectWaiting"));
		obNext.disabled = true;
	}
}

function startObDetecting() {
	stopPolling();
	obNext.disabled = true;
	runObDetect();
	pollTimer = setInterval(runObDetect, 4000);
}

document.querySelector('[data-step="obsidian-connect"]').addEventListener("step-enter", startObDetecting);
// 高级区改了 key/端口 → 立即用新配置重新检测
for (const id of ["#apiKey", "#port"]) {
	$(id).addEventListener("input", startObDetecting);
}
```

- [ ] **Step 3: i18n 两个 locale 同步更新**

**删除**(两个 locale 都删): `wizObConnectStep1`、`wizObConnectStep2`、`wizObConnectStep3`、`wizObTestHint`、`optTestConnection`

先确认 `optTestConnection` 无其他引用:`grep -rn "optTestConnection" extension/` 应只剩 messages.json 里的定义。

**修改 + 新增**,`zh_CN/messages.json`:

```json
	"wizObConnectTitle": { "message": "第二步:连接 Obsidian" },
	"wizObConnectIntro": { "message": "保持 Obsidian 开着就行,扩展会自动连上(新版插件已默认开启连接通道)。" },
	"wizObDetectWaiting": { "message": "正在连接…请确认 Obsidian 开着、Media Companion 插件已启用。装的是旧版插件?去 设置 → Media Companion 把 API 开关打开。" },
	"wizObAdvancedNote": { "message": "扩展通过本机端口(127.0.0.1)把图片发给 Obsidian 插件,数据不出这台电脑。本机上的其他程序理论上也能访问这个端口;想加一层防护,就在插件设置里填一个 API key,并把同一个 key 粘到下面。不想用这个通道,在插件设置里关掉 API 开关即可。" },
```

`en/messages.json`:

```json
	"wizObConnectTitle": { "message": "Step 2: Connect to Obsidian" },
	"wizObConnectIntro": { "message": "Just keep Obsidian running — the extension connects automatically (the latest plugin ships with the connection enabled)." },
	"wizObDetectWaiting": { "message": "Connecting… Make sure Obsidian is running and the Media Companion plugin is enabled. On an older plugin version? Open Settings → Media Companion and turn on the API toggle." },
	"wizObAdvancedNote": { "message": "The extension sends clips to the Obsidian plugin through a local port (127.0.0.1) — data never leaves this computer. Other apps on this machine could technically reach that port too; for extra protection, set an API key in the plugin settings and paste the same key below. Don't want this channel at all? Turn off the API toggle in the plugin settings." },
```

保留不动: `wizObAdvanced`、`wizObKeyLabel`、`optPort`、`optConnected`、`errObsidian*` 三个错误键。

- [ ] **Step 4: 验证**

Run: `cd /Users/liyachen/Documents/fang/inspiration-clipper && node --test tests/*.test.mjs`
Expected: 全绿(i18n 键集合一致性、占位符数量由现有用例把关)

再跑一次残留引用检查:
Run: `grep -rn "ob-test\|wizObTestHint\|wizObConnectStep\|optTestConnection" extension/`
Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add extension/options/options.html extension/options/options.js extension/_locales/zh_CN/messages.json extension/_locales/en/messages.json
git commit -m "feat: obsidian step 2 auto-detects connection, port/key folded into advanced

Media Companion >=1.3.0 enables its local API by default, so the manual
'enable API, paste key, test' form gate is gone. O2 now mirrors the Notion
branch: 4s polling via the shared pollTimer, auto-enables Next on success.
Advanced <details> keeps port/key overrides with a plain-language note on
how the local channel works and its risk surface."
```

---

### Task 3: 设计文档补决策记录

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-onboarding-redesign-design.md`(文末追加一节)

**Interfaces:**
- Consumes: Task 1、Task 2 的最终行为(文档描述以已提交代码为准)

- [ ] **Step 1: 文末追加决策记录**

在该 spec 文件末尾追加:

```markdown

## 2026-08-01 决策:Obsidian O2 改零配置自动检测

**背景:** 用户质疑 O2 为何要填端口/Key/手动测试,而旧项目(screenshot-clipper,走 17183 独立本地服务)没有这一步。调查确认:本地 API 是扩展写入 vault 的唯一通路(架构必然),但 O2 表单里端口与 Key 双端默认值本就对齐,唯一真实动作只有"开 API 开关"。

**决策:** Media Companion fork 默认 `apiEnabled: true`(v1.3.0);O2 照搬 Notion N2 的 4 秒轮询自动检测,端口/Key 收进折叠高级区。

**风险与知情(方案成立的前提):**
- 服务只监听 127.0.0.1,网络不可达;风险面是本机其他程序与网页的盲发写入,最坏后果为向 vault 塞入垃圾条目。用户评估此风险可接受。
- 换取的是所有 Media Companion 用户(含不用扩展的)默认多开一个本地端口,因此插件设置面板必须有原理/风险/关闭方式的说明文案——这不是可选项。
- 曾保存过设置的老用户 `apiEnabled: false` 已落盘,默认值变更对其无效;O2 等待文案中包含手动开开关的指引兜底。

**未采用:** 默认生成随机 API Key(更安全,但扩展读不到 Key,用户须手动复制粘贴,重新引入了比"开开关"更重的步骤,零配置目标落空)。
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-29-onboarding-redesign-design.md
git commit -m "docs: record zero-config obsidian connect decision and risk tradeoff"
```
