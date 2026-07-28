# 灵感库（Swipe File）设计 spec

日期：2026-07-28
状态：待用户确认

## 一句话目标

在 Chrome 里一击截图（或右键存原图），自动落入 creation-flywheel vault 的 `灵感库/` 文件夹，以随机排序的瀑布流 gallery 浏览，支持手动打标和 AI 批量打标，全程本地、全程 git。

## 明确不在范围内

- Visual Clipper / vault-autopilot 的任何改动（视频工作流完全不动）
- 手机端捕获
- 去重、离线排队补传、Git LFS
- 面向他人的产品化 / 订阅激活（架构上留了路，但本期不设计）

## 架构总览

```
[灵感 clipper 扩展 (Chrome MV3)]
    ├── 工具栏点击 → 区域框选截图（一击入库，零弹窗）
    └── 右键网页图片 → "存入灵感库"（原图原分辨率）
            │  POST /api/upload {imageBase64, filename, folder, tags, sourceUrl, sourceTitle}
            ▼
[Media Companion fork @ localhost:27124]（跑在 creation-flywheel vault 里）
    ├── 图片写入 灵感库/，自动生成 sidecar .md
    ├── fork 改动 1：文件夹白名单（只扫指定文件夹）
    └── fork 改动 2：瀑布流视图随机排序（每次打开重洗）
            ▼
creation-flywheel/灵感库/
    ├── 手动：Obsidian 里直接在 sidecar 上打原生标签
    ├── AI：/tag-gallery skill 看图批量打标（对照分类维度 SOP）
    └── obsidian-git 自动 commit 备份

[Visual Clipper → vault-autopilot:17183 → 主 vault 视频库]  ← 不动
```

两条流永不相交。数据只在本机流动（localhost + 本地文件），API 有 key 鉴权。

## 组件 1：Media Companion fork

上游：`Nick-de-Bruin/obsidian-media-companion`（MIT license，fork / 修改 / 移植其扩展代码均无障碍）。
Gallery 基于 Obsidian 官方 Bases，**要求 Obsidian ≥ 1.11.5**（实施前在 creation-flywheel 里验证）。

### 改动 1：文件夹白名单

- settings 新增 `includedFolders: string[]`（空数组 = 保持现状全库扫，向后兼容）
- `cache.ts` 两处 `vault.getFiles()` 与 mutation 监听按白名单过滤
- sidecar 只为白名单内媒体生成；白名单外的图（如笔记贴图）不进 gallery、不生成 sidecar
- 对应上游已有需求 [#26 [FR] Whitelist/blacklist folders](https://github.com/Nick-de-Bruin/obsidian-media-companion/issues/26)

### 改动 2：瀑布流随机排序

- waterfall Bases 视图新增「Shuffle」开关（视图配置项，随 Bases 视图持久化）
- 开启时：每次视图打开（onOpen/onload）对条目重新洗牌；关闭时走 Bases 原生排序
- 验收：连续打开两次，首屏图片顺序不同

### 维护策略

改动按可直接提上游的标准写（英文注释、跟随上游代码风格、互不耦合的两个独立 PR）。
先提 PR（白名单挂 #26，随机排序先开 issue 说明动机），fork 只在等合并期间使用；合并后回归官方版。
上游节奏约一两个月一更，有收社区 PR 的记录（#35、#44）。最坏情况：长期用 fork，可接受。

## 组件 2：灵感 clipper 扩展（Chrome MV3）

起点：上游仓库自带的 `browser-extension/`（Firefox MV2，38 行 background + popup），转成 MV3；区域框选 overlay 从 Visual Clipper `extension/content.js` 移植。

### 行为

- **工具栏点击 / 快捷键** → 页面上区域框选 → 截图直接 POST 到默认文件夹 → 右下角 toast「已存入灵感库」。**全程零弹窗、零决策**（capture first, categorize second）
- **右键网页图片** → 菜单「存入灵感库」→ 拉取原图（原始分辨率）POST 入库
- 每张图自动带 `sourceUrl` + `sourceTitle`（sidecar 里可回溯来源）
- 标签捕获时一律不打，交给后置的手动/AI 流程

### 设置页（一次性配置）

- 端口（默认 27124）、API key、默认目标文件夹（默认 `灵感库`）

### 错误处理

- Obsidian 没开 / 插件没启用 → toast 明确报错：「Obsidian（creation-flywheel）没开，这张没存上」。不静默失败，本期不做排队重试
- 文案：中文单语（个人工具；将来产品化再做 i18n，参照 Visual Clipper 的 _locales 模式）

### 已知端口风险

27124 与 obsidian-local-rest-api 的默认 HTTPS 端口重合。creation-flywheel 目前未装该插件；若将来装，改其中一方端口即可（两边都可配）。

## 组件 3：/tag-gallery skill + 分类维度 SOP

- 新 Claude Code skill：扫 `灵感库/` 中无标签的 sidecar → 读对应图片（vision）→ 对照 `灵感库/SOP/分类维度.md` 打标 → 直接写 sidecar frontmatter 的原生标签（如 `#灵感/配色`）→ Obsidian 自动感知，gallery 立即生效
- **分类维度 SOP 从空开始**：先裸收约 100 张，skill 首次运行时反向归纳维度草稿供用户修改后固化。不预设分类
- 手动与 AI 写同一格式，永远兼容；跑 skill 用用户自己的 Claude Code 订阅（先例：thumbnail-swipe）
- skill 不删除、不覆盖已有的人工标签，只补空缺

## 使用约定（不用开发，写下来防走样）

- 在 creation-flywheel 写内容时用 `[[sidecar]]` 双链引用灵感图；sidecar 的 backlinks = 这张图被用过几次，是库里唯一真实的质量信号
- 库的浏览入口 = 随机瀑布流视图（复访旧图靠随机重现，代替刻意月度复盘）

## 实施顺序

0. 前置检查：creation-flywheel 的 Obsidian ≥ 1.11.5；vault 先 git commit
1. Media Companion fork（白名单 + 随机排序），装进 creation-flywheel，验证 gallery
2. 灵感 clipper 扩展 MV3，打通 Chrome → 灵感库 链路
3. /tag-gallery skill + SOP 模板
4. 上游 PR ×2

## 验收标准（Definition of Done）

1. Chrome 工具栏点击 → 框选 → 图片出现在 `creation-flywheel/灵感库/`，带 sidecar，sidecar 记录来源 URL
2. 右键网页图片 → 存入 → 原图（非缩放渲染图）入库
3. `Images/` 里的笔记贴图不出现在 gallery、不生成 sidecar
4. 瀑布流视图开启 Shuffle 后，连续打开两次首屏顺序不同
5. Obsidian 关闭时捕获 → 收到明确中文报错，无静默丢失
6. /tag-gallery 跑完后，无标签 sidecar 获得 SOP 内维度的标签；已有人工标签的 sidecar 不被改动
7. 全流程无任何数据离开本机（除 obsidian-git push 到用户自己的 GitHub）

## 记录在案、本期不做

- 手机端捕获（先观察真实需求频率；临时方案：手机截图回电脑拖入）
- 去重（将来可由 /tag-gallery 顺手报告重复）
- 扩展离线排队、断点补传
- Git 仓库超 GB 后的 LFS / 备份策略迁移
- 产品化：订阅激活、i18n、商店上架
