# 多目的地灵感 clipper 设计 spec

日期：2026-07-28
状态：待用户确认
与既有文档的关系：本文是**定位转向后的新设计**，不是对 `2026-07-28-inspiration-library-design.md` 的小修。
旧 spec 中「Media Companion fork」部分仍然有效（它现在的职责收窄为**Obsidian 侧的呈现层**，不再承担写入）。

---

## 定位转向（本文存在的理由）

原设计是「给我自己用的 Obsidian 灵感库」。本次转向为：

> **给内容创作者用的、把视觉素材存进他们已经在用的笔记应用的工具。**

转向的触发点：意识到把方案锁死在 Obsidian 会排除绝大多数目标用户，而"让用户换笔记软件"违背核心主张。

## 一句话目标

在浏览器里一击捕获**图片 / GIF / 短视频**，自动存入用户**已经在用的**笔记应用（第一版：Obsidian、Notion），并在那里以画廊形式呈现——不要求用户适应任何新工具，全程免费，零服务器。

## 目标人群

**为创作收集素材的非设计师，且已经在用某个通用笔记应用。**
自媒体、写作者、做视频的、做 PPT 的。**明确不是专业设计师**——那个市场有 Savee / Cosmos / Eagle，已经饱和。

## 明确不在范围内

- 来源平台特例集成（Instagram / Pinterest / X / 小红书 hover 快存）——维护黑洞
- **Android 端捕获**（iOS 端见组件 6；Android 无低成本路径，理由见「记录在案」）
- **原生移动 app**（iOS $99/年 + 审核；Android $25 + 长期维护）
- Safari 扩展（Apple Developer Program $99/年，与"免费"直接冲突）
- 去重、离线排队补传
- **任何需要自建服务器的方案**（这是硬约束，不是偏好）
- File System Access API（理由见「安全立场」）

---

## 竞品结论（2026-07-28 调研）

### 为什么这件事没人做

现有工具分成两个血统，**没有一个跨过来**：

| 血统 | 代表 | DNA | 缺什么 |
|---|---|---|---|
| **Clipper 系** | Obsidian / Notion 官方 clipper、web-clipper（19 平台） | 稍后读 + 文章存档，文本 | 不碰媒体文件 |
| **视觉收藏系** | Savee / Cosmos / Eagle / Pinterest | 图 | 永远建自己的仓库，从不写进别人的笔记 |

**「能存动态视觉 + 能写进你自己的笔记 app」这个交集是空的。**

### 关键证据

- **Obsidian 官方 clipper 明确不做本地图片**：[issue #37](https://github.com/obsidianmd/obsidian-clipper/issues/37) 已 CLOSED，官方回复「暂不支持，可用 Local Images 插件」。用户抱怨：「图片是以 http 引用存的」——链接一烂，库就空了。
- **唯一的多平台开源方案已停更**：[webclipper/web-clipper](https://github.com/webclipper/web-clipper)，6.8k star，支持 19 个目的地，但最后 commit **2025-10-21**，227 open issues，README 对媒体类型只字未提。
- **SyncNos-Webclipper**（Notion/Obsidian/飞书，AGPL，还在更新）只处理文字、markdown、视频字幕。
- **装机量反差**：Savee 官网称 100 万用户，Chrome 扩展只有 **7,000** 装机；Save to Cosmos 和 mymind 各 100,000。说明"主动收集"是远小于"逛"的行为。
- **Obsidian vs Notion 的收集行为密度**：Notion 1 亿用户 / clipper 100 万装机 = **1%**；Obsidian ~100 万用户 / clipper 90 万装机 = **接近 90%**。评分 3.3★ vs 4.8★。

### 需求验证的诚实状态

- ✅ **「存了翻不回来」是真痛点**：[Ask HN #46826277](https://news.ycombinator.com/item?id=46826277)，235 分 / 217 条评论。用户 phippsytech 在没见过本方案的情况下独立提出「被动的、电台式的信息流，把收集的东西播放回给我」——即随机复现。kyriakos 用自建工具一年「只回去找过两次」。
- ❌ **「非设计师主动回看视觉素材」未证实**：217 条评论里几乎无人谈图片；唯一说自己会回翻 swipe file 的人自称「作为一个设计师」。
- ⚠️ **取样缺陷**：HN 是程序员社区，不是目标人群。**Reddit 全程无法访问**（firecrawl 不支持该站 / Jina 403 / JSON API 403），r/ObsidianMD、r/Notion 的一手讨论未读到。

**结论：需求未被证伪，也未被证实。本项目当作"带验证目的的建造"来做**——作者本人是目标用户，库是空的，可用真实回访率检验。

---

## 架构

```
┌─ 捕获层 ──────────────────────────────── 已有，不动
│   区域框选截图 · 右键存原图 · 右键存 GIF/直链视频
│         ↓  CaptureItem（内存对象，不落盘）
│   { blob, mime, filename, sourceUrl, sourceTitle, capturedAt }
└──────────────────────────────────────────────────
                      ↓
┌─ 路由层 ──────────────────────────────── 新
│   · 查目标 adapter 的 capabilities()
│   · blob.size > maxFileSize → 按用户配置降级到备选目的地
│   · 全失败 → toast 明确报错（i18n + 数值占位符），不静默丢
└──────────────────────────────────────────────────
                      ↓
┌─ 适配器层 ────────────────────────────── 新
│   A 族：localhost + multipart（一次请求）
│     ObsidianAdapter → Local REST API 插件 PUT /vault/{path}
│   B 族：云端 REST + 多步握手
│     NotionAdapter → POST /v1/file_uploads
│                   → POST /v1/file_uploads/{id}/send
│                   → 创建 database page 引用它
└──────────────────────────────────────────────────
```

**接口必须同时套住 A、B 两族**——这是它够不够抽象的唯一检验标准：

```js
{
  id, displayName,        // displayName 走 i18n
  configFields(),         // 配置页渲染什么（标签也走 i18n）
  test(),                 // 连通性检查 → 状态卡红绿灯，顺便实探 capabilities
  capabilities(),         // { maxFileSize, supportsVideo, supportsTags }
  save(item)              // 唯一写入口，内部自决一步还是多步
}
```

### 三条设计约束

1. **`capabilities()` 必须动态实探，不能写死常量。** Notion 的 `maxFileSize` 要在 `test()` 时从 bot user 的 `workspace_limits.max_file_upload_size_in_bytes` 读——同一个 adapter，免费 workspace 是 5MB，付费的是 5GB。
2. **捕获层完全不知道 adapter 存在。** 它只产 `CaptureItem`。以后加目的地，捕获层一行不改。
3. **降级策略住路由层，不住 adapter。** adapter 只回答"我能不能存、怎么存"，"存不下该去哪"是策略。

---

## 组件 1：捕获层（已有，几乎不动）

已完成并 commit：

| commit | 内容 |
|---|---|
| `f384376` | 区域框选流程（overlay 从 Visual Clipper 移植，裁剪在 SW） |
| `1117121` | 右键存原图（按需申请 host permission） |
| `c6592e9` | 右键存 GIF 和直链视频 |
| `20d2e2e` | popup 状态卡片（连接红绿灯 + 捕获按钮） |

**唯一改动**：`extension/lib/upload.js` 目前硬编码打到 Media Companion 的 localhost API，需抽成 adapter 调用。

**这三样恰好是所有现有 clipper 都没有的能力**，是本项目的技术资产。

## 组件 2：路由层（新）

- 读 `capabilities()`，`blob.size` 超限则按用户配置降级
- 降级链示例：Notion（5MB 上限）→ 超了 → Obsidian（无上限）
- 失败必须可见：toast 明确报错，含动态数值（「这个 GIF 是 8.2 MB，超过你 Notion 免费版 5 MB 上限，已改存到 Obsidian」）
- 本期不做重试队列

## 组件 3：适配器层（新）

### ObsidianAdapter

- 依赖用户安装社区插件 [obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api)（README：「full CRUD on any file in your vault, **including binary files**」）
- `PUT /vault/{path}` 写媒体文件 + 写 sidecar `.md`
- `maxFileSize: Infinity`
- **注**：原计划自写 Media Companion fork 承担写入，现已不必要——Local REST API 已经在了。Media Companion fork 的职责收窄为呈现层（文件夹白名单 + 瀑布流）。

### NotionAdapter

- 三步：`POST /v1/file_uploads` → `POST /v1/file_uploads/{id}/send`（multipart）→ 创建 database page 引用 file_upload
- 官方文档的示例命令用的就是 GIF：`-F "file=@path/to-file.gif"`，返回 `"content_type": "image/gif"`
- 授权：**internal integration**。用户自建 integration → 复制 `ntn_***` token → 在目标数据库 `···` → Connections 添加。**零服务器**。
- 不走 public OAuth：Notion **不支持 PKCE**（token 交换需 `Authorization: Basic $CLIENT_ID:$CLIENT_SECRET`，secret 不能放进扩展），必须有服务器，违反硬约束。
- 单次上传 API 上限 20MB，超过走分片；**但 workspace 限制叠加在上面，免费版 5MB**。

## 组件 4：目的地模板（新增工作量）

**关键认知：交付物不是"一个扩展"，是"一个扩展 + 每个目的地一份配好的呈现模板"。**
没有它，用户装完扩展只会得到一堆散图——正是本项目要消灭的东西。

- **Notion 模板**（用户 duplicate）：预配画廊视图（卡片预览指向图片属性）、随机 formula 属性 + 按它排序的视图、约定好的属性结构（sourceUrl / sourceTitle / capturedAt / tags）、以及"建 integration"的分步引导。模板本来就是 Notion 生态最自然的分发方式。
- **Obsidian**：一份 `.base` 文件 + 文件夹约定。随机用 Bases 原生 `formulas: {shuffle: random()}` + `groupBy`（**已实测**：每次重开视图顺序变、单次会话内滚动稳定）。

## 组件 5：i18n

- **中英双语**，`chrome.i18n` + `_locales/en` + `_locales/zh_CN`
- 照抄 Visual Clipper 的现成模式（`screenshot-clipper/extension/_locales/`，各 226 条，完全同步）
- 跟随浏览器语言，第一版不做手动切换
- 覆盖面按文案量排序：Notion 接入引导 > 错误文案（含数值 placeholders，不许拼字符串）> options 配置页 > popup 状态卡 > toast > manifest 的 name/description（`__MSG_xxx__`）
- **这条推翻旧 spec 第 85 行**（原为「中文单语，将来产品化再做 i18n」）

## 组件 6：iOS 快捷指令模板

**手机端不写任何代码**，只提供一份配好的 iOS 快捷指令，用户导入即用。

- 链路：分享菜单 → 快捷指令 → `POST /v1/file_uploads` → `/send` → 建 database page
- 扩展在这条链路里**完全不参与**
- 字段结构与扩展写入的完全一致，手机存的和电脑存的落进同一个画廊
- 成本：零代码、零审核、零费用。跟组件 4 的目的地模板是同一类交付物
- 可行性已确认：社区已有《How to Upload Photos to Notion with Apple Shortcuts & Notion API (2025)》等教程走通同一条路

### 结构性约束：手机端只支持云目的地

| 目的地 | 桌面 | 手机 |
|---|:--:|:--:|
| Obsidian（localhost HTTP） | ✅ | ❌ **结构上不可能** |
| Notion（云 HTTPS） | ✅ | ✅ |
| 飞书（云 HTTPS，待定） | ✅ | ✅ |

Obsidian 不可能的两个独立原因：

1. `obsidian-local-rest-api` 插件页明确标注 **「Desktop only」**（同类的 Render API 插件亦然）。移动版 Obsidian 没有 Node 的 `http` 模块，起不了 HTTP 服务器。网传「改 manifest 的 `isDesktopOnly: false` 就能在手机跑」的 hack 对纯 JS 插件有时管用，对需要监听端口的插件必然失败。
2. 即便能跑，**手机上的 Obsidian 与电脑上的 vault 是两台机器**，`localhost` 不指向同一个东西。

**这把架构翻了个面**：桌面上最好的目的地（本地优先）在手机上唯一不可用；手机上唯一可用的（云端）恰是体积受限的那个。必须在文档中向用户讲明——这是结构问题，不是能力缺失。

### 为什么不用 PWA

`share_target` 在 **iOS Safari 完全不支持**（MDN 兼容表；[WebKit bug 194593](https://bugs.webkit.org/show_bug.cgi?id=194593) 自 2019 年开启至今未实现），Firefox 与 Android WebView 亦不支持。即便在 Android 上，实际使用者反馈：只在 Chrome for Android 生效（其他 Chromium 浏览器不行），且接收分享会不可恢复地打断用户当前操作。

---

## 安全立场：为什么不用 File System Access API

Mozilla 对 FSA 的[正式立场](https://mozilla.github.io/standards-positions/)是 **negative**，理由原文：

> ……但它跟另一些东西捆在一起了，那些东西我们认为不可能取得有意义的用户同意，**尤其是跨站访问用户的本地文件系统**。整体上我们认为它有害。

（另有 issue #738「实现 API 子集」立场为 defer，明确说主要顾虑就是 `showDirectoryPicker()` 和 `FileSystemDirectoryHandle`。WebKit 立场类似。）

**判断：这个顾虑对浏览器扩展只部分适用，但适用的部分足够致命：**

1. 同意问题不因为是扩展就消失——非技术用户点过目录选择器时，未必明白自己授出了整棵目录树的**持久读+写**
2. **读权限是搭着来的**：你要"写进一张图"，拿到的是"读走这个文件夹里的一切"，严重超配
3. **Chrome 扩展会被卖掉**——这是有据可查的生态问题。持久化在 IndexedDB 的目录句柄落到未来买主手上就是负债

**采纳的替代模式：让目的地 app 自己授权。**

| | 谁在授权 | 权限范围 |
|---|---|---|
| ~~FSA API~~ | 文件系统 → 扩展 | 整棵目录树，读+写，持久 |
| **Obsidian 插件** | **Obsidian** | 只有那个 vault |
| **Notion Connections** | **Notion** | 只有连上的那个数据库 |

这个模式顺带解决跨浏览器问题——都只是 HTTP 请求，Chrome/Firefox 一视同仁。

---

## 目的地准入标准

**必须能"呈现"，不只是能"存"。**

一个 GIF 躺在某个笔记的附件里、没有任何画廊能看到它，正好就是本项目要消灭的"坟场"。为这种目的地写 adapter 等于亲手制造要解决的问题。

三根支柱：**① 能传二进制 ② 有画廊/瀑布流 ③ 能随机重现**

### 第一版目的地

| | 传二进制 | 画廊 | 随机 | 体积上限 |
|---|:--:|:--:|:--:|---|
| **Obsidian** | ✅ | ✅ Bases | ✅ 原生 `random()`，已实测 | 无 |
| **Notion** | ✅ | ✅ 画廊视图 | 🟡 formula hack，**待实测** | **免费版 5MB** |

两者并列，不分先后。

**注意此处与准入标准存在一处有条件的例外**：Notion 的第三根支柱（随机重现）尚未验证，因此它是**有条件准入**——通过实施顺序第 0 步才算数。若第 0 步证明 Notion 做不到每次打开重洗，则不是把 Notion 踢出去（人群在那里，且它是手机端唯一可用目的地），而是必须为它另配一套复现机制（见「未解决的问题」第 2 条）。这条例外是自觉的，不是疏漏。

### 已淘汰（附理由，防止重复调研）

- **Joplin** ❌ —— 写入完全没问题（`POST /resources`，官方文档示例就是传图片）。**但它连缩略图都没有**，画廊视图在论坛上[还只是 feature request](https://discourse.joplinapp.org/t/notes-view-gallery-view/19720)。存得进，看不见，出局。
- **Logseq** ❌ —— HTTP API 在（`:12315`），但[「plugin API 写 assets」的 feature request 仍未实现](https://discuss.logseq.com/t/feature-request-ability-to-write-assets-from-plugin-api/5047)。文字能写，图写不进去。
- **flomo** ❌ —— webhook **明确不支持图片**；URL scheme `flomo://create?image_urls=[...]` 只收公网 URL，本地刚截的图没有 URL。
- **语雀** ⚠️ —— 生态工具全是导出向（yuque-exporter、Yuque-DL），未找到公开的文件上传接口，也未找到画廊视图证据。**标为未验证、倾向出局**，非确证。

### 待定（数据已备，捡起来时不用重查）

**飞书多维表格** —— 能力上其实最强，2026-07-28 用户决定暂缓：

- 写入 ✅ 两步：`POST /open-apis/drive/v1/medias/upload_all` 拿 `file_token` → 新增记录写进附件字段。官方文档示例返回体就是 GIF（`"name": "2.gif", "size": 10250625`）
- **单附件 2 GB**；单次 API 20MB，超过分片。每表 20,000 附件，每单元格 100 个
- **存储配额**：基础版（企业未认证）总 15 GB；**个人账号 100 GB**
- 呈现 ✅ **画册视图**：「以每行中上传的附件为主体内容……像相册一样灵活查看视觉内容」，支持紧凑模式
- **随机 ❌** —— 多维表格只有日期/逻辑/文本/数字/位置 5 类函数，**无 random**。仅有 workaround：[BaseScript-RandomSort](https://github.com/ConnectAI-E/BaseScript-RandomSort)（物理打乱，一次性）或集成平台「随机数助手」定时写字段
- **取舍记录**：飞书在"免费存动态视觉"上比 Notion 强 400 倍（2GB vs 5MB），但在"随机重现"上比 Notion 更差。用户选择先做 Notion，理由是人群密度（1 亿用户 + 成熟的中文自媒体模板生态）

**思源** —— 候选。`/api/asset/upload`（`127.0.0.1:6806`，multipart）✅，画廊/卡片视图已发布 ✅，**随机未查**。用户量小（官方 Chrome 扩展仓库仅 305 star）。与 Obsidian adapter 同形状，边际成本近零。

---

## 收端（浏览器）

| 浏览器 | 状态 | 成本 |
|---|---|---|
| Chrome | ✅ MV3 | 开发者注册一次性 $5 |
| Edge | ✅ 同代码 | 免费 |
| Arc / Brave / Opera / Vivaldi | ✅ 装 CWS 包 | 零 |
| Firefox | ✅ 需小改（background 是 event page 不是纯 SW） | AMO 免费 |
| Safari | ❌ 本期不做 | **$99/年**，且仅 App Store 分发 |

**时间背景**：Chrome 151（2026-07-28 stable，即本 spec 撰写当日）已删除 Chromium 源码里最后的 MV2 开关；2026-08-31 CWS 移除所有剩余 MV2 扩展。MV3 是唯一选项。

---

## 实施顺序

0. **前置实测：Notion 随机排序**。建数据库 + formula 随机属性 + 按它排序，反复关开看顺序是否变化。**这是必答题**——若不成立，Notion 用户拿到的是按时间倒序的漂亮坟场，需另配复现机制
1. adapter 接口 + 路由层，把现有 `upload.js` 重构进去
2. ObsidianAdapter（Local REST API），跑通端到端
3. NotionAdapter（三步上传 + capabilities 实探），跑通端到端
4. 降级链（Notion 超 5MB → Obsidian）
5. i18n（`_locales` 双语）
6. 两份目的地模板 + 接入引导
7. iOS 快捷指令模板（依赖第 3 步的 NotionAdapter 已跑通，字段结构定稿后才能做）
8. Firefox 适配

## 验收标准（Definition of Done）

1. Chrome 工具栏点击 → 框选 → 图片出现在配置的目的地，带 sourceUrl
2. 右键存原图 → 原始分辨率入库（非缩放渲染图）
3. 右键存 GIF → **落地的是能动的 GIF**，不是静态帧
4. 同一次捕获，切换目的地配置后能分别落到 Obsidian 和 Notion
5. 传一个 >5MB 的 GIF 到 Notion 免费版 → **自动降级到 Obsidian，并有明确 toast 说明原因和去向**
6. 目的地不可用时（Obsidian 没开 / token 失效）→ 明确报错，无静默丢失
7. 浏览器语言切到 en → 全部 UI 和错误文案为英文
8. 用两份模板配好后，Obsidian 和 Notion 两侧都能看到画廊
9. 从 iPhone 分享菜单存一张图 → 出现在与桌面捕获**同一个** Notion 画廊里，字段结构一致
10. 全流程无任何数据经过第三方服务器（只有用户自己的 Notion workspace）

## 未解决的问题

1. **Notion 随机排序能否做到"每次打开重洗"** —— 在关键路径上，见实施顺序第 0 步。手机端进来后 Notion 成为唯一全平台可用的目的地，此题分量更重
2. **是否需要自建查看器** —— 若随机重现在多数目的地都做不到，产品可能需要自带一个浏览器内的随机瀑布流查看器（新标签页）。这会把产品从"捕获器"变成"捕获器 + 查看器"，是重大范围扩张。**暂不决策，等第 0 步结论**
3. **真实回访率** —— 本项目的根本假设（存了会被翻出来）仍未验证。作者是目标用户且库为空，应记录自己三个月的回访次数作为一手数据
4. **Reddit 一手数据缺口** —— 本轮调研全程无法访问 Reddit，r/ObsidianMD、r/Notion 的用户讨论未读。可用 `/last30days` 补

## 记录在案、本期不做

- **Android 端捕获** —— PWA + Web Share Target 路线已排除（见组件 6）；原生 app 需 Google Play $25 一次性 + 长期维护。等出现真实需求再评估
- Safari 扩展（$99/年）
- 飞书、思源 adapter（数据已备，见「待定」）
- 来源平台特例（Instagram / Pinterest / X hover 快存）——注：Cosmos 的这个能力可能比区域截图更贴近普通人行为，值得将来重估
- 去重、离线排队、失败重试
- 自建 OAuth 代理（一旦做，"零服务器"约束即失效，需重新评估）
