# 灵感剪藏 Inspiration Clipper

看到好图，右键一下，存进你自己的灵感库——支持 **Obsidian**（本地笔记库）和 **Notion** 两种去处。

- 网页图片一键收藏，或框选截图任意区域
- 来源网址、页面标题自动记下，日后能找回出处
- 首次安装自动弹出设置向导，跟着点就配好，不用懂任何技术细节

## 安装扩展

1. [点这里下载最新版](https://github.com/echore/inspiration-clipper/releases/latest/download/inspiration-clipper.zip)，解压
2. 打开 Chrome 的 `chrome://extensions`，右上角打开"开发者模式"
3. 点"加载已解压的扩展程序"，选择解压出来的 `inspiration-clipper` 文件夹
4. 装好后设置向导会自动打开，选一个去处跟着走即可

## 两种去处

### 存到 Obsidian（图片落在你自己电脑上）

向导会引导你装配套插件 [Media Companion](https://github.com/echore/obsidian-media-companion/releases/latest)（v1.3.0 起免配置）：装好插件、开着 Obsidian，扩展会自动连上，选个文件夹就完成。图片存进库里后自动生成 sidecar 笔记，可打标签、可搜索、有瀑布流画廊。

**它是怎么连上的？** 插件在你电脑上开一个只有本机能访问的小通道（127.0.0.1:27124），扩展把图片从这里递进笔记库——数据不出你的电脑。本机其他程序和网页理论上也能碰到这个通道；介意的话在插件设置里配一个 API key（向导的"高级选项"里粘同一个 key），或者关掉它。

### 存到 Notion（跨设备同步）

向导会引导你：创建一个 Notion integration 拿到密钥 → 一键复制我们准备好的模板库（中英文各一份）→ 在库页面上"连接"这个 integration。扩展只认你自己复制的库，绝不会在你的 Notion 里擅自建东西。

## 隐私

没有任何第三方服务器。图片和记录要么直接进你本地的 Obsidian，要么直接从浏览器发给 Notion 官方接口，仅此而已。

## 开发

```bash
node --test tests/*.test.mjs
```

纯 vanilla JS（Manifest V3），无构建步骤，`extension/` 目录即成品。
