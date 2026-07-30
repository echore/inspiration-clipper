// options.js — 向导 UI 的 DOM 布线层。一页两态:未配置走分步向导,
// 已配置显示总览卡片。逻辑(步骤流转/清洗/请求体)都在 lib 里,这里只接线。
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
let pendingDatabaseId = ""; // N3 建好(或沿用)但还没保存的库

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
	// 步骤自己的进场逻辑(如 N3 的"沿用现有库"探测)挂在这个事件上
	const active = document.querySelector(`[data-step="${step}"]`);
	if (active) active.dispatchEvent(new CustomEvent("step-enter"));
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
