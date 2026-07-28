# Media Companion Fork（文件夹白名单 + 随机瀑布流）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork `Nick-de-Bruin/obsidian-media-companion`，加两个功能——sidecar/gallery 只扫白名单文件夹、瀑布流视图每次打开随机排序——装进 creation-flywheel vault 并准备上游 PR。

**Architecture:** 白名单 = 一个纯函数过滤器（`isWithinFolders`）插进 cache 的三个入口（初始扫描、增量更新、文件事件）；随机排序 = 每个视图实例一个随机种子 + Fisher-Yates 洗牌，接在瀑布流 rebuild 的收集循环之后。测试基建（vitest）只留在 fork，不进上游 PR 分支。

**Tech Stack:** TypeScript / esbuild（上游现有）+ vitest（fork-only）。Obsidian 插件，gallery 基于官方 Bases API。

**本计划是 spec 的第 1/3 个子系统**（spec: `docs/superpowers/specs/2026-07-28-inspiration-library-design.md`）。计划 2（Chrome 扩展）、计划 3（/tag-gallery skill）在本计划完成后另行编写。

## Global Constraints

- creation-flywheel 的 Obsidian ≥ **1.11.5**（上游 manifest `minAppVersion`），Task 0 验证，不满足则停下报告
- 上游 license MIT；所有可能进上游 PR 的代码/注释/UI 字符串一律**英文**，跟随上游代码风格（tab 缩进、现有命名习惯）
- **commit 纪律**：功能实现 commit 不得包含测试文件或 vitest 配置；测试相关单独 commit，message 前缀 `test(fork):` 或 `chore(fork):`（PR 分支要 cherry-pick 纯实现 commit）
- 不删除用户文件：白名单收窄后，已存在的界外 sidecar 留在原地（孤儿 .md 无害），绝不自动删除
- creation-flywheel vault 任何改动前先 git commit 快照
- fork 本地路径：`/Users/liyachen/Documents/fang/obsidian-media-companion`

---

### Task 0: 前置检查（用户参与）

**Files:** 无代码改动。

- [ ] **Step 1: 确认 Obsidian 版本**

请用户在 creation-flywheel vault 里看 设置 → 通用 → 关于（或 `⌘,` 左下角版本号），报告版本。要求 ≥ 1.11.5。不满足 → 让用户升级 Obsidian 后再继续，本计划暂停。

- [ ] **Step 2: creation-flywheel git 快照**

```bash
cd /Users/liyachen/Documents/creation-flywheel && git add -A && git commit -m "chore: snapshot before media-companion install" || echo "nothing to commit (clean tree also OK)"
```

Expected: commit 成功或工作树本来就干净。

---

### Task 1: Fork + 构建基线

**Files:**
- Create: `/Users/liyachen/Documents/fang/obsidian-media-companion/`（gh fork clone）

**Interfaces:**
- Produces: 可构建的 fork 仓库，`npm run build` 产出根目录 `main.js`；remote `origin` = echore fork，`upstream` = Nick-de-Bruin 原仓库

- [ ] **Step 1: fork 并 clone**

```bash
cd /Users/liyachen/Documents/fang && gh repo fork Nick-de-Bruin/obsidian-media-companion --clone --default-branch-only
cd obsidian-media-companion && git remote -v
```

Expected: `origin` 指向 `echore/obsidian-media-companion`，`upstream` 指向 `Nick-de-Bruin/obsidian-media-companion`（gh fork --clone 自动配好）。注意：GitHub fork 天然是 public 的（MIT，无问题）。

- [ ] **Step 2: 安装依赖并验证基线构建**

```bash
cd /Users/liyachen/Documents/fang/obsidian-media-companion && npm install && npm run build && ls -la main.js
```

Expected: `tsc -noEmit` 无错误，esbuild 产出 `main.js`。若上游基线就构建失败，停下报告，不要自行修上游的错。

---

### Task 2: 测试基建（fork-only）

**Files:**
- Modify: `package.json`（devDependencies + scripts.test）
- Create: `tests/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` 可运行 vitest；后续任务的测试放 `tests/`

- [ ] **Step 1: 安装 vitest 并加 test script**

```bash
cd /Users/liyachen/Documents/fang/obsidian-media-companion && npm install -D vitest
```

在 `package.json` 的 `scripts` 中加：`"test": "vitest run"`。

- [ ] **Step 2: 写 smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";

describe("test infra", () => {
	it("runs", () => {
		expect(1 + 1).toBe(2);
	});
});
```

- [ ] **Step 3: 运行验证**

Run: `npm test`
Expected: 1 passed。

- [ ] **Step 4: Commit（fork-only 前缀）**

```bash
git add package.json package-lock.json tests/smoke.test.ts
git commit -m "chore(fork): add vitest test infra (fork-only, excluded from upstream PRs)"
```

---

### Task 3: 文件夹白名单纯函数（TDD）

**Files:**
- Create: `src/util/folderFilter.ts`
- Test: `tests/folderFilter.test.ts`

**Interfaces:**
- Produces: `isWithinFolders(path: string, folders: string[]): boolean` — `folders` 为空数组时恒真（= 上游现状，全库）；`normalizeFolders(raw: string): string[]` — 把设置文本框的原始输入（逗号/换行分隔）解析成规范化文件夹列表（去空格、去首尾 `/`、去空项）

- [ ] **Step 1: 写失败测试**

```ts
// tests/folderFilter.test.ts
import { describe, it, expect } from "vitest";
import { isWithinFolders, normalizeFolders } from "../src/util/folderFilter";

describe("isWithinFolders", () => {
	it("includes everything when whitelist is empty", () => {
		expect(isWithinFolders("anywhere/a.png", [])).toBe(true);
		expect(isWithinFolders("root.png", [])).toBe(true);
	});
	it("includes direct children of a whitelisted folder", () => {
		expect(isWithinFolders("灵感库/a.png", ["灵感库"])).toBe(true);
	});
	it("includes nested descendants", () => {
		expect(isWithinFolders("灵感库/sub/deep/b.png", ["灵感库"])).toBe(true);
	});
	it("excludes files in other folders", () => {
		expect(isWithinFolders("Images/c.png", ["灵感库"])).toBe(false);
	});
	it("does not match sibling folders sharing a name prefix", () => {
		expect(isWithinFolders("灵感库2/d.png", ["灵感库"])).toBe(false);
	});
	it("excludes root-level files when whitelist is non-empty", () => {
		expect(isWithinFolders("root.png", ["灵感库"])).toBe(false);
	});
	it("supports multiple folders", () => {
		expect(isWithinFolders("refs/e.png", ["灵感库", "refs"])).toBe(true);
	});
});

describe("normalizeFolders", () => {
	it("splits on commas and newlines, trims, strips slashes, drops empties", () => {
		expect(normalizeFolders(" 灵感库/ ,\n/refs/sub/,, ")).toEqual(["灵感库", "refs/sub"]);
	});
	it("returns [] for blank input", () => {
		expect(normalizeFolders("   \n ")).toEqual([]);
	});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/util/folderFilter`。

- [ ] **Step 3: 实现**

```ts
// src/util/folderFilter.ts
/**
 * Returns whether a vault-relative file path lies within any of the given
 * folders. An empty folder list means no restriction (include everything),
 * which preserves the plugin's default behavior.
 */
export function isWithinFolders(path: string, folders: string[]): boolean {
	if (folders.length === 0) return true;
	return folders.some(folder => path === folder || path.startsWith(`${folder}/`));
}

/**
 * Parses the raw settings text (comma or newline separated) into a
 * normalized folder list: trimmed, leading/trailing slashes removed,
 * empty entries dropped.
 */
export function normalizeFolders(raw: string): string[] {
	return raw.split(/[\n,]/)
		.map(part => part.trim())
		.map(part => part.replace(/^\/+|\/+$/g, ""))
		.filter(part => part.length > 0);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: 两个 commit（实现与测试分开）**

```bash
git add src/util/folderFilter.ts
git commit -m "feat: add folder whitelist path filter utility"
git add tests/folderFilter.test.ts
git commit -m "test(fork): cover folderFilter utility"
```

---

### Task 4: 白名单接线（settings + cache + mutationHandler）

**Files:**
- Modify: `src/settings.ts`（interface + DEFAULT_SETTINGS）
- Modify: `main.ts`（MediaCompanionSettingTab.display()，约 116-190 行区域）
- Modify: `src/cache.ts`（`initialize()` 约 65 行、`updateExtensions()` 约 122-135 行）
- Modify: `src/mutationHandler.ts`（`createMediaFile()` 约 156 行、`onMoved()` 约 102-135 行）

**Interfaces:**
- Consumes: Task 3 的 `isWithinFolders` / `normalizeFolders`
- Produces: `MediaCompanionSettings.includedFolders: string[]`（默认 `[]`）；设置页新文本框 "Included folders"；cache 与文件事件全部尊重白名单

- [ ] **Step 1: settings.ts 加字段**

interface 中（`sidecarTemplate: string;` 之后）加：

```ts
	includedFolders: string[];
```

`DEFAULT_SETTINGS` 中（`sidecarTemplate: "",` 之后）加：

```ts
	includedFolders: [],
```

- [ ] **Step 2: main.ts 设置页加文本框**

在 `MediaCompanionSettingTab.display()` 里，模仿现有 `extensionDebounce` 模式。文件顶部 import 区加：

```ts
import { normalizeFolders } from 'src/util/folderFilter';
```

在 `extensionDebounce` 定义后加：

```ts
		const foldersDebounce = debounce(async (value: string) => {
			this.plugin.settings.includedFolders = normalizeFolders(value);
			await this.plugin.saveSettings();
			await this.plugin.cache.updateExtensions();
		}, 500, true);
```

在 'Extensions' Setting 块之后加：

```ts
		new Setting(containerEl)
			.setName('Included folders')
			.setDesc('Only scan these folders for media (comma or newline separated). Leave empty to scan the entire vault.')
			.addTextArea(text => text
				.setPlaceholder('Inspiration, Assets/refs')
				.setValue(this.plugin.settings.includedFolders.join(', '))
				.onChange(async (value) => {
					foldersDebounce(value);
				}));
```

- [ ] **Step 3: cache.ts 两处过滤**

文件顶部加 import：

```ts
import { isWithinFolders } from "./util/folderFilter";
```

`initialize()` 中现有的扩展名过滤行：

```ts
		files = files.filter(f => this.plugin.settings.extensions.contains(f.extension.toLowerCase()));
```

其后紧跟加一行：

```ts
		files = files.filter(f => isWithinFolders(f.path, this.plugin.settings.includedFolders));
```

`updateExtensions()` 中现有的：

```ts
		this.files = this.files.filter(f => this.plugin.settings.extensions.contains(f.file.extension.toLowerCase()));
```

改为（同时按白名单收窄已缓存文件）：

```ts
		this.files = this.files.filter(f => this.plugin.settings.extensions.contains(f.file.extension.toLowerCase())
			&& isWithinFolders(f.file.path, this.plugin.settings.includedFolders));
```

同函数中新文件扫描的扩展名过滤行（`files = files.filter(f => this.plugin.settings.extensions.contains(...));`）之后加：

```ts
		files = files.filter(f => isWithinFolders(f.path, this.plugin.settings.includedFolders));
```

- [ ] **Step 4: mutationHandler.ts 守卫**

文件顶部加 import：

```ts
import { isWithinFolders } from "./util/folderFilter";
```

`createMediaFile()` 是 onFileCreated / onMoved 共用的唯一造点。在其函数体开头的 TFile 类型检查之后、任何创建逻辑之前加：

```ts
		if (!isWithinFolders(file.path, this.plugin.settings.includedFolders)) return null;
```

`onMoved()` 处理「从白名单内移出去」：在 sidecar rename 块（`if (sidecar) { void this.app.fileManager.renameFile(...) }`）之后、`if (!cacheFile)` 之前加：

```ts
		if (cacheFile && !isWithinFolders(file.path, this.plugin.settings.includedFolders)) {
			this.cache.removeFile(file);
			this.dispatchEvent(new CustomEvent("file-deleted", { detail: cacheFile }));
			return;
		}
```

（移入白名单的方向不用加代码：`!cacheFile` 分支调用 `createMediaFile`，Step 4 的守卫放行白名单内路径，现有逻辑自动成立。）

- [ ] **Step 5: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: tsc 无错误、构建成功、测试全绿。

- [ ] **Step 6: Commit（纯实现）**

```bash
git add src/settings.ts main.ts src/cache.ts src/mutationHandler.ts
git commit -m "feat: folder whitelist setting to limit media scanning (#26)"
```

- [ ] **Step 7: 手动验证（用户参与，一次性 dev vault）**

搭一个临时 vault 验证，不动 creation-flywheel：

```bash
mkdir -p /private/tmp/claude-501/-Users-liyachen-Documents-fang-screenshot-clipper/7402e66e-f4c9-4a71-8102-4a48081d754b/scratchpad/mc-dev-vault/{Inspiration,Other}
cd /Users/liyachen/Documents/fang/obsidian-media-companion
mkdir -p /private/tmp/claude-501/-Users-liyachen-Documents-fang-screenshot-clipper/7402e66e-f4c9-4a71-8102-4a48081d754b/scratchpad/mc-dev-vault/.obsidian/plugins/media-companion
cp main.js manifest.json styles.css /private/tmp/claude-501/-Users-liyachen-Documents-fang-screenshot-clipper/7402e66e-f4c9-4a71-8102-4a48081d754b/scratchpad/mc-dev-vault/.obsidian/plugins/media-companion/
```

放两张任意 png 分别进 `Inspiration/` 和 `Other/`。请用户：Obsidian 打开该 vault → 启用 Media Companion → 设置 Included folders = `Inspiration` → 重载插件。
验收：gallery 只出现 Inspiration 的图；`Other/` 内图片**没有** `.sidecar.md` 生成；把 Other 里的图移入 Inspiration 后出现在 gallery，移回去后消失。

---

### Task 5: 洗牌纯函数（TDD）

**Files:**
- Create: `src/util/shuffle.ts`
- Test: `tests/shuffle.test.ts`

**Interfaces:**
- Produces: `mulberry32(seed: number): () => number`（确定性 PRNG，返回 [0,1) 浮点）；`shuffleInPlace<T>(arr: T[], rand: () => number): T[]`（Fisher-Yates，原地洗牌并返回同一数组）

- [ ] **Step 1: 写失败测试**

```ts
// tests/shuffle.test.ts
import { describe, it, expect } from "vitest";
import { mulberry32, shuffleInPlace } from "../src/util/shuffle";

describe("mulberry32", () => {
	it("is deterministic for the same seed", () => {
		const a = mulberry32(42), b = mulberry32(42);
		expect([a(), a(), a()]).toEqual([b(), b(), b()]);
	});
	it("produces values in [0, 1)", () => {
		const r = mulberry32(7);
		for (let i = 0; i < 100; i++) {
			const v = r();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
});

describe("shuffleInPlace", () => {
	const base = () => Array.from({ length: 10 }, (_, i) => i);
	it("keeps exactly the same elements", () => {
		const arr = shuffleInPlace(base(), mulberry32(1));
		expect([...arr].sort((x, y) => x - y)).toEqual(base());
	});
	it("is deterministic for the same seed", () => {
		expect(shuffleInPlace(base(), mulberry32(5))).toEqual(shuffleInPlace(base(), mulberry32(5)));
	});
	it("differs across different seeds", () => {
		expect(shuffleInPlace(base(), mulberry32(1))).not.toEqual(shuffleInPlace(base(), mulberry32(2)));
	});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/util/shuffle`。

- [ ] **Step 3: 实现**

```ts
// src/util/shuffle.ts
/**
 * Mulberry32: a small, fast, deterministic PRNG. Used so a shuffled view
 * keeps a stable order for the lifetime of one view instance.
 */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Fisher-Yates shuffle using the provided random source. Mutates and
 * returns the same array.
 */
export function shuffleInPlace<T>(arr: T[], rand: () => number): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: 两个 commit（实现与测试分开）**

```bash
git add src/util/shuffle.ts
git commit -m "feat: add seeded shuffle utility for view ordering"
git add tests/shuffle.test.ts
git commit -m "test(fork): cover shuffle utility"
```

---

### Task 6: 瀑布流视图接入 Shuffle 开关

**Files:**
- Modify: `src/views/waterfall-bases-view.ts`（类字段区约 39-50 行、`onDataUpdated()` 约 96-125 行、收集循环后约 240 行、`getWaterfallViewOptions()` 的 "Search" group 之前）

**Interfaces:**
- Consumes: Task 5 的 `mulberry32` / `shuffleInPlace`
- Produces: Bases 瀑布流视图配置项 `shuffleOrder`（toggle，默认 false）；开启后每次打开视图首屏顺序随机、同一实例内滚动稳定

- [ ] **Step 1: import + 实例种子字段**

文件顶部加：

```ts
import { mulberry32, shuffleInPlace } from "../util/shuffle";
```

类字段区（`private gap = 8;` 附近）加：

```ts
	// One seed per view instance: each open gets a fresh order, while
	// scrolling within the same instance stays stable.
	private shuffleSeed = Math.floor(Math.random() * 0xffffffff);
```

- [ ] **Step 2: onDataUpdated 读取配置并纳入指纹**

`onDataUpdated()` 中 `const searchQuery = ...` 行之后加：

```ts
		const shuffleOrder = this.config.get("shuffleOrder") === true;
```

现有指纹行：

```ts
		const fingerprint = `${dataIds}|${filterColor}|${colorThreshold}|${filterShape}|${filterMinWidth}|${filterMaxWidth}|${filterMinHeight}|${filterMaxHeight}|${searchQuery}`;
```

末尾追加 `|${shuffleOrder}`（保证开关切换触发完整 rebuild）：

```ts
		const fingerprint = `${dataIds}|${filterColor}|${colorThreshold}|${filterShape}|${filterMinWidth}|${filterMaxWidth}|${filterMinHeight}|${filterMaxHeight}|${searchQuery}|${shuffleOrder}`;
```

- [ ] **Step 3: 收集循环后洗牌**

在 rebuild 路径中，`for (const group of this.data.groupedData)` 收集循环结束、后续布局/定位逻辑开始之前，加：

```ts
		if (shuffleOrder) {
			shuffleInPlace(this.layoutItems, mulberry32(this.shuffleSeed));
		}
```

（锚点判断：该循环把条目填进 `this.layoutItems`；洗牌必须发生在任何 `col/x/y` 计算之前。）

- [ ] **Step 4: 视图配置加 toggle**

`getWaterfallViewOptions()` 返回数组中，"Search" group 之前插入：

```ts
		{
			type: "group",
			displayName: "Order",
			items: [
				{
					type: "toggle",
					key: "shuffleOrder",
					displayName: "Shuffle on open",
					default: false,
				},
			],
		},
```

（若 tsc 报 toggle 类型不存在，查 `obsidian-typings` 中 Bases view option 的合法 type 列表，用其布尔开关类型等价替换——判断标准：设置面板出现一个开关，`config.get("shuffleOrder")` 返回布尔。）

- [ ] **Step 5: 构建 + 全量测试**

Run: `npm run build && npm test`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add src/views/waterfall-bases-view.ts
git commit -m "feat: optional shuffle-on-open ordering for waterfall view"
```

- [ ] **Step 7: 手动验证（用户参与，复用 Task 4 dev vault）**

重新 `cp main.js` 到 dev vault 插件目录，往 `Inspiration/` 放约 10 张图。请用户：重载插件 → 瀑布流视图设置里开 "Shuffle on open" → 关闭视图再打开，重复两次。
验收：两次打开首屏顺序不同；同一次打开内上下滚动顺序不跳变；关掉开关后恢复 Bases 原生排序。

---

### Task 7: 部署进 creation-flywheel + 配置灵感库

**Files:**
- Create: `/Users/liyachen/Documents/creation-flywheel/.obsidian/plugins/media-companion/{main.js,manifest.json,styles.css}`
- Create: `/Users/liyachen/Documents/creation-flywheel/灵感库/`（文件夹）+ `灵感库/灵感库.base`（Bases 视图文件，用户在 GUI 创建）

**Interfaces:**
- Consumes: Task 4/6 构建出的 main.js
- Produces: spec DoD 第 3、4 条通过的可用灵感库（收的链路要等计划 2 的扩展）

- [ ] **Step 1: 快照 + 部署**

```bash
cd /Users/liyachen/Documents/creation-flywheel && git add -A && git commit -m "chore: snapshot before media-companion deploy" || true
mkdir -p .obsidian/plugins/media-companion 灵感库
cp /Users/liyachen/Documents/fang/obsidian-media-companion/main.js /Users/liyachen/Documents/fang/obsidian-media-companion/manifest.json /Users/liyachen/Documents/fang/obsidian-media-companion/styles.css .obsidian/plugins/media-companion/
```

（记忆里的部署坑：esbuild 产物在仓库根目录，**必须** cp 进 vault 插件目录并重载插件，别以为 build 完就生效。）

- [ ] **Step 2: 用户在 Obsidian 里配置**

请用户在 creation-flywheel：启用 Media Companion → 设置：Included folders = `灵感库`；Enable API server = on；API key 填一个随机串（用户自己生成保存，**不要发给我**）→ 新建 Base（`灵感库/灵感库.base`）→ 视图切到 Media Companion 的 waterfall → filter 设为 `file.folder` 包含 `灵感库` → 开 "Shuffle on open"。

- [ ] **Step 3: 验收（对照 spec DoD）**

往 `灵感库/` 拖 3 张图、确认 `Images/`（vault 已有笔记贴图）不受影响：
- DoD 3：`Images/Pasted image *.png` 不在 gallery、无 sidecar 生成
- DoD 4：视图连开两次首屏顺序不同
- `curl -s http://localhost:27124/api/ping`（用户跑）返回成功 → API 就绪，计划 2 的前置条件达成

- [ ] **Step 4: vault commit**

```bash
cd /Users/liyachen/Documents/creation-flywheel && git add -A && git commit -m "feat: media-companion fork installed; 灵感库 folder + shuffled waterfall base"
```

---

### Task 8: 上游 PR 准备（用户把关后才推送）

**Files:**
- Create: fork 上两个分支 `feat/folder-whitelist`、`feat/shuffle-on-open`

**Interfaces:**
- Consumes: Task 3/4 的 whitelist commits、Task 5/6 的 shuffle commits（`git log --oneline` 确认 hash）

- [ ] **Step 1: 从 upstream/master 切两个纯功能分支**

```bash
cd /Users/liyachen/Documents/fang/obsidian-media-companion && git fetch upstream
git checkout -b feat/folder-whitelist upstream/master
# cherry-pick Task 3 的 folderFilter 实现 commit 与 Task 4 的接线 commit（hash 以 git log 为准）
git cherry-pick <folderFilter-impl-hash> <whitelist-wiring-hash>
npm run build   # 确认纯功能分支独立可构建
git checkout -b feat/shuffle-on-open upstream/master
git cherry-pick <shuffle-impl-hash> <waterfall-wiring-hash>
npm run build
git checkout master
```

Expected: 两个分支各自构建通过，且都不含 vitest/tests（`git diff upstream/master --stat` 里不出现 tests/ 或 package.json 的 vitest 行）。

- [ ] **Step 2: 起草 PR 文案（英文）并交用户审阅**

whitelist PR 挂 issue #26（标题示例 `feat: folder whitelist to limit media scanning (closes #26)`，正文说明：empty = current behavior、三个接线点、不删除既有 sidecar）；shuffle 先开 issue 说明动机（random resurfacing for inspiration libraries）再提 PR。文案写好后**先贴给用户看，用户点头后**才 `git push origin` + `gh pr create`（对外发布动作，逐个确认）。

---

## Self-Review 记录

- Spec 覆盖：fork 两改动（Task 3-6）、部署配置（Task 7）、上游 PR 策略（Task 8）、Obsidian 版本前置（Task 0）均有任务；spec 其余部分属计划 2/3
- 类型一致：`isWithinFolders(path, folders)` / `normalizeFolders(raw)` / `mulberry32(seed)` / `shuffleInPlace(arr, rand)` 各任务引用一致；settings 字段统一 `includedFolders`
- 已知不确定点（已在任务内给出判断标准，不是占位符）：Bases 视图 option 的 toggle 具体 type 名（Task 6 Step 4 附替代路径）；洗牌插入点以「收集循环后、定位计算前」为锚（Task 6 Step 3）
