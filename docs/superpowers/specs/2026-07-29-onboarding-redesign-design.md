# 引导式配置(Onboarding)重设计

日期:2026-07-29
状态:已与用户对齐,待实现

## 目标

把配置体验从"裸表单"改成有引导的分步流程,让不懂技术的用户不看文档也能独立配好一个目的地并测通。

- **范围内**:options 页重构为向导、首装自动打开、Notion 自动建库、Notion test 增强、完成页使用教学、全部文案中英双语。
- **范围外**:adapter/router 的保存链路、popup 布局、settings 数据结构。
- **完成标准**:新用户从装上扩展到测试连接变绿,全程每一步都有下一步指引;测不通就无法"完成",不存在"保存了但其实是坏的"状态。

## 已确认的决策

1. **完整首装引导**:`onInstalled`(reason=install)自动打开设置页。
2. **向导即设置页(一页两态)**:未配置(`settings.chain.length === 0`)进向导;已配置显示总览卡片,可重入向导。不新建第二个页面。
3. **分步向导**:一次只显示一步,顶部进度指示,每步可即时验证,绿灯才能前进。
4. **Notion 自动建库**:用户不手建数据库、不找数据库 ID;扩展调 API 在用户选定的页面下创建带全部 5 个属性的数据库。
5. **Obsidian 从装插件教起**:覆盖完全陌生用户,含 fork 插件的侧载步骤。

## 用户流程

### 状态判定

打开 options 页 → `loadSettings()` → `chain.length > 0` 走总览态,否则走向导态。不新增任何 settings 字段。

### 总览态

一张卡片:目的地名称 + 状态灯(打开时自动跑一次 `adapter.test`)+ 关键配置摘要(Obsidian 显示文件夹,Notion 显示数据库链接)。按钮:

- **重新配置** → 进入该目的地分支的凭据步(Obsidian 进 O2,Notion 进 N1),表单预填现有值;仍可自由后退/前进
- **换目的地** → 进入向导第 1 步

底部一行使用提醒(快捷键 + 右键菜单)。

### 向导态

**第 1 步(共同)— 选目的地。** 两张大卡片:

- Obsidian — 存到你电脑本地的笔记库(需要先装一个插件)
- Notion — 存到云端数据库(需要 Notion 账号,免费版就行)

**Obsidian 分支:**

| 步 | 内容 | 前进条件 |
|---|---|---|
| O1 装插件 | 下载按钮指向 `https://github.com/echore/obsidian-media-companion/releases/latest`;三行步骤:下载 zip → 解压到笔记库的 `.obsidian/plugins/` 文件夹 → Obsidian 设置里启用 Media Companion | 用户自查,点"我装好了" |
| O2 开 API、粘 key | 教:Obsidian 设置 → Media Companion → 打开 Local API 开关 → 复制 API key;本步含 key 粘贴框;"高级"折叠里放端口(默认 27124) | 点"测试连接",`obsidianAdapter.test` 绿灯 |
| O3 选文件夹,完成 | 文件夹输入框,默认"灵感库" | 点"完成"→ 保存 settings(chain=["obsidian"]) |

**Notion 分支:**

| 步 | 内容 | 前进条件 |
|---|---|---|
| N1 建 integration、粘 token | 按钮打开 `notion.so/my-integrations`;步骤:新建 → 名字随意 → 复制 Internal Integration Secret;粘贴框 `input` 事件即时清洗(去空白、剥尖括号) | 点"验证",`/users/me` 通过 |
| N2 分享页面并选择 | 教:在 Notion 打开任意页面 → ⋯ → 连接 → 选你的 integration;扩展调 `POST /v1/search`(filter: page)列出 integration 可见页面供点选;带"刷新列表"按钮 | 选中一个页面 |
| N3 一键建库 | 点"帮我建库" → `POST /v1/databases`(parent=选中页面,5 个属性)→ 回填 databaseId → 自动跑增强版 test。重入场景:若已有 databaseId 且增强测试通过,显示"沿用现有库"并可直接完成,不重复建库 | 建库(或沿用)+ 完整测试通过 → 保存 settings(chain=["notion"]) |

**完成页(共同):** 教使用,不是只说"已保存":

- 框选截图:Alt+Shift+S(或点扩展图标里的按钮)
- 存整张图:右键图片 →「存入灵感库」
- 提示:现在就可以去任意网页试一试

向导内可后退;后退不清空已填内容。

## 技术设计

### 文件改动

| 文件 | 改动 |
|---|---|
| `extension/options/options.html` | 重写:每步一个 `<section data-step>`,JS 控制显隐;总览卡片同为一个 section |
| `extension/options/options.js` | 重写:步骤切换、每步验证、总览渲染;DOM 布线薄层,逻辑下沉 lib |
| `extension/lib/onboarding.js`(新增) | 纯函数:`sanitizeToken()`、步骤流转表(`nextStep`/`prevStep`)、`createDatabasePayload()`、`mapSearchResults()`;不碰 DOM/chrome API |
| `extension/lib/adapters/notion.js` | 新增 `searchPages(cfg)`、`createDatabase(cfg, parentPageId)`;`test(cfg)` 增强(见下);属性名抽成常量与 `notionPageProperties` 共用 |
| `extension/background.js` | `chrome.runtime.onInstalled` → reason 为 install 时 `chrome.runtime.openOptionsPage()` |
| `extension/_locales/{en,zh_CN}/messages.json` | 新增全部向导文案,双语 |

### Notion test() 增强

现状只验 token(`/users/me`),数据库未分享也绿灯——上次手动测试踩过的坑。增强为两段:

1. `/users/me` → 401 返回 `errNotionToken`
2. `GET /v1/databases/{databaseId}` → 失败返回新键 `errNotionDatabase`(数据库不可见,确认它已分享给你的 integration)

两段全过才 `ok: true`。capabilities 逻辑不变。

### 建库请求体

`createDatabasePayload(parentPageId)` 输出的 5 个属性(Name/Image/Source URL/Source Title/Captured)与 `notionPageProperties()` 引用同一组属性名常量,单一事实来源,保证建的库与写入的条目永远一致。

### token 清洗

`sanitizeToken(raw)`:trim + 剥掉包裹的尖括号(复制损坏的实际案例)。在 N1 粘贴框的 `input` 事件即时执行;Obsidian 的 apiKey 粘贴框同样套用。

### 错误处理

沿用 errorKey → i18n 机制,每步内联提示、原地重试,不把用户踢回第一步。新增键:

- `errNotionDatabase` — 数据库不可见
- `errNotionSearchEmpty` — 没检测到已分享页面(提示完成分享后点刷新)
- `errNotionCreateDb` — 建库失败,可重试

文案守则:零术语、人话、不用尖括号占位符。

## 测试

`node --test 'tests/*.test.js'`(glob,不用目录)。纯函数全覆盖:

- `sanitizeToken`:正常 / 带空白 / 带尖括号
- `createDatabasePayload`:5 个属性齐全、类型正确、与页面属性常量一致
- 步骤流转:两分支各自的前进/后退/完成条件
- 增强版 `test()`:mock fetch 三种结果(token 坏 / 库不可见 / 全通)
- `mapSearchResults`:过滤非 page、提取标题(含无标题页面兜底)

DOM 布线不做单测,与现有代码一致。

## 验收标准

1. 首次安装自动打开设置页并进入向导第 1 步
2. 两条分支都能在不看任何外部文档的情况下走到"完成",每步有指引、有验证
3. Notion 分支全程不需要用户手动复制数据库 ID 或手建属性
4. token 粘贴含尖括号/空白时自动清洗,验证仍通过
5. Notion 测试在"token 对但库未分享"时给出明确提示(不再假绿灯)
6. 已配置用户打开设置页看到总览卡片与实时连接状态,可重入向导修改
7. 全部新文案中英双语,`node --test` 全绿

## 修订(2026-07-30,用户实测后裁定)

**放弃"扩展自动建库",改为"模板复制"流程。** 实测暴露两个致命问题:
1. 按页面搜索会把旧灵感库的每一条条目都列出来(每条在 Notion 里都是页面),出现几十项无意义列表;
2. 自动建库对用户完全不透明——建在哪、为什么建,用户无感知也无控制权。

新 Notion 流程(与 screenshot-clipper 时代验证过的流程一致,共 2 步):
1. 建 integration、粘 token(不变)
2. 打开官方模板 → 用户自己 Duplicate 到工作区(位置、名字自己定)→ 在复制出的数据库页面 Connections 连接 integration → 扩展检测数据源(search filter=data_source,非 page),校验五列齐全后显示库名让用户确认 → 完成

相应地:`createDatabase`/`createDatabasePayload`/`searchPages` 从 adapter 移除,新增 `searchDataSources`+`mapDataSourceResults`(含缺列检查,错误键 `errNotionSchema`);`errNotionCreateDb` 移除。模板页由开发者维护(五列 + 一条示例),发布后 URL 写入 `NOTION_TEMPLATE_URL` 常量。

## 2026-08-01 决策:Obsidian O2 改零配置自动检测

**背景:** 用户质疑 O2 为何要填端口/Key/手动测试,而旧项目(screenshot-clipper,走 17183 独立本地服务)没有这一步。调查确认:本地 API 是扩展写入 vault 的唯一通路(架构必然),但 O2 表单里端口与 Key 双端默认值本就对齐,唯一真实动作只有"开 API 开关"。

**决策:** Media Companion fork 默认 `apiEnabled: true`(v1.3.0);O2 照搬 Notion N2 的 4 秒轮询自动检测,端口/Key 收进折叠高级区。

**风险与知情(方案成立的前提):**
- 服务只监听 127.0.0.1,网络不可达;风险面是本机其他程序与网页的盲发写入,最坏后果为向 vault 塞入垃圾条目。用户评估此风险可接受。
- 换取的是所有 Media Companion 用户(含不用扩展的)默认多开一个本地端口,因此插件设置面板必须有原理/风险/关闭方式的说明文案——这不是可选项。
- 曾保存过设置的老用户 `apiEnabled: false` 已落盘,默认值变更对其无效;O2 等待文案中包含手动开开关的指引兜底。

**未采用:** 默认生成随机 API Key(更安全,但扩展读不到 Key,用户须手动复制粘贴,重新引入了比"开开关"更重的步骤,零配置目标落空)。
