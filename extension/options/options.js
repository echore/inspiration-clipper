// options.js — 向导 UI 的 DOM 布线层。一页两态:未配置走分步向导,
// 已配置显示总览卡片。逻辑(步骤流转/清洗/请求体)都在 lib 里,这里只接线。
import { loadSettings, saveSettings } from "../lib/settings.js";
import { ADAPTERS } from "../lib/adapters/index.js";
import { notionAdapter } from "../lib/adapters/notion.js";
import {
	sanitizeToken, flowFor, nextStep, prevStep, firstCredentialStep, stepNumber,
} from "../lib/onboarding.js";
import { t } from "../lib/i18n.js";

document.querySelectorAll("[data-i18n]").forEach((el) => {
	el.textContent = t(el.dataset.i18n);
});

const $ = (sel) => document.querySelector(sel);

// —— 向导会话状态(不落盘;落盘只发生在"完成") ——
let dest = "";
let currentStep = "";
let configured = false; // 已有落盘配置 → choose 步可以退回总览
let pendingDatabaseId = ""; // N2 检测到、但还没保存的库
let pollTimer = null; // N2 自动检测轮询

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

function stopPolling() {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

// —— 顶部导航:固定位置的"上一步",choose 步在已配置时退回总览 ——
function updateTopbar(step) {
	const back = $("#back-link");
	const hideBack = step === "overview" || step === "done" || (step === "choose" && !configured);
	back.hidden = hideBack;
	if (!hideBack) {
		back.textContent = "← " + (step === "choose" ? t("wizBackToOverview") : t("wizBack"));
	}
	// 进度点:仅分支步骤显示
	const progress = $("#progress");
	progress.textContent = "";
	const n = stepNumber(dest, step);
	const total = flowFor(dest).length;
	if (n > 0) {
		for (let i = 1; i <= total; i++) {
			const dot = document.createElement("span");
			dot.className = i <= n ? "dot on" : "dot";
			progress.appendChild(dot);
		}
		progress.appendChild(document.createTextNode(t("wizStepOf", [String(n), String(total)])));
	}
}

function show(step) {
	stopPolling(); // 离开任何步骤都停掉检测轮询;进 N2 会重新开
	currentStep = step;
	document.querySelectorAll("[data-step]").forEach((s) => {
		s.hidden = s.dataset.step !== step;
	});
	// 步骤自己的进场逻辑(N2 自动检测、N3 沿用探测)挂在这个事件上
	const active = document.querySelector(`[data-step="${step}"]`);
	if (active) active.dispatchEvent(new CustomEvent("step-enter"));
	updateTopbar(step);
}

function setStatus(el, kind, msg) {
	el.className = `inline-status ${kind}`;
	el.textContent = msg;
}

// —— 总览态 ——
async function showOverview(settings) {
	dest = settings.chain[0];
	configured = true;
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
		const target = nextStep(dest, currentStep);
		if (target) show(target);
	});
});
$("#back-link").addEventListener("click", async () => {
	if (currentStep === "choose") {
		showOverview(await loadSettings());
		return;
	}
	const target = prevStep(dest, currentStep);
	if (target) show(target);
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
	configured = true;
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

// —— Notion N2:复制模板 → 在库页面上"连接"→ 扩展自动认出这个库。
// 库放在哪、叫什么全是用户自己在 Notion 里操作的,扩展绝不代建。
// 检测的是数据库(不是页面),所以旧条目不会出现在这里。 ——
const NOTION_TEMPLATE_URL = "https://fifree.notion.site/346652dc2947404b8ac202f5cb5b4738?v=3ad942e6a5928095b281000c954d0d0d";
$("#no-template-link").href = NOTION_TEMPLATE_URL;

const noFinish = $("#no-finish");
const detectStatus = () => $("#no-detect-status");

function chooseDb(source) {
	pendingDatabaseId = source.databaseId;
	noFinish.disabled = false;
}

function renderDbList(sources) {
	const list = $("#db-list");
	list.textContent = "";
	let stillThere = false;
	for (const source of sources) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "page-item";
		btn.textContent = source.title || t("optUntitledPage");
		if (pendingDatabaseId === source.databaseId) {
			btn.classList.add("selected");
			stillThere = true;
		}
		btn.addEventListener("click", () => {
			chooseDb(source);
			list.querySelectorAll(".page-item").forEach((b) => b.classList.remove("selected"));
			btn.classList.add("selected");
		});
		list.appendChild(btn);
	}
	if (!stillThere) noFinish.disabled = true;
}

async function runDetect() {
	const r = await notionAdapter.searchDataSources({ token: sanitizeToken(tokenInput.value) });
	if (!r.ok) {
		if (r.errorKey === "errNotionSearchEmpty") {
			// 用户还没在 Notion 里完成"连接"——不是错误,继续等
			setStatus(detectStatus(), "", t("wizNoDetectWaiting"));
		} else {
			setStatus(detectStatus(), "bad", t(r.errorKey ?? "errGeneric"));
			stopPolling();
		}
		return;
	}
	const usable = r.sources.filter((s) => s.missing.length === 0);
	if (usable.length === 0) {
		// 连接上了,但不是模板复制的库:指名道姓说缺哪些列,继续等换库
		const bad = r.sources[0];
		setStatus(detectStatus(), "bad", t("errNotionSchema", [bad.title || t("optUntitledPage"), bad.missing.join(", ")]));
		return;
	}
	stopPolling();
	if (usable.length === 1) {
		// 常见情况:只连接了一个库 → 直接认出它,显示名字,零操作
		$("#db-list").textContent = "";
		chooseDb(usable[0]);
		setStatus(detectStatus(), "ok", t("wizNoDetected", [usable[0].title || t("optUntitledPage")]));
	} else {
		setStatus(detectStatus(), "", t("wizNoDetectMulti"));
		renderDbList(usable);
	}
}

function startDetecting() {
	stopPolling();
	noFinish.disabled = true;
	runDetect();
	pollTimer = setInterval(runDetect, 4000);
}

document.querySelector('[data-step="notion-connect"]').addEventListener("step-enter", startDetecting);
$("#no-refresh").addEventListener("click", startDetecting);

// 完成前再跑一次完整测试(token + 库可见),测不过不落盘
$("#no-finish").addEventListener("click", async () => {
	const cfg = notionCfg();
	const r = await notionAdapter.test(cfg);
	if (!r.ok) {
		setStatus(detectStatus(), "bad", t(r.errorKey ?? "errGeneric"));
		return;
	}
	const s = await loadSettings();
	await saveSettings({
		chain: ["notion"],
		byAdapter: { ...s.byAdapter, notion: cfg },
	});
	configured = true;
	show("done");
});
