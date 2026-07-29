import { loadSettings, saveSettings } from "../lib/settings.js";
import { ADAPTERS } from "../lib/adapters/index.js";
import { t } from "../lib/i18n.js";

// Fill in i18n text
document.querySelectorAll("[data-i18n]").forEach((el) => {
	const key = el.dataset.i18n;
	el.textContent = t(key);
});

const form = document.querySelector("form");
const destSelect = document.querySelector("#dest");
const portInput = document.querySelector("#port");
const apiKeyInput = document.querySelector("#apiKey");
const folderInput = document.querySelector("#folder");
const tokenInput = document.querySelector("#token");
const databaseIdInput = document.querySelector("#databaseId");
const savedMsg = document.querySelector("#saved");

// Load and populate form
(async () => {
	const s = await loadSettings();

	// Backfill form
	destSelect.value = s.chain[0] ?? "";
	portInput.value = s.byAdapter.obsidian.port ?? 27124;
	apiKeyInput.value = s.byAdapter.obsidian.apiKey ?? "";
	folderInput.value = s.byAdapter.obsidian.folder ?? "灵感库";
	tokenInput.value = s.byAdapter.notion.token ?? "";
	databaseIdInput.value = s.byAdapter.notion.databaseId ?? "";
})();

// Save form
form.addEventListener("submit", async (e) => {
	e.preventDefault();
	savedMsg.textContent = "";

	const dest = destSelect.value ? [destSelect.value] : [];

	await saveSettings({
		chain: dest,
		byAdapter: {
			obsidian: {
				port: Number(portInput.value) || 27124,
				apiKey: apiKeyInput.value.trim(),
				folder: folderInput.value.trim() || "灵感库",
			},
			notion: {
				token: tokenInput.value.trim(),
				databaseId: databaseIdInput.value.trim(),
			},
		},
	});

	savedMsg.textContent = t("optSaved");
});

// Test adapters
document.querySelectorAll("[data-test-adapter]").forEach((btn) => {
	btn.addEventListener("click", async (e) => {
		e.preventDefault();
		const id = btn.dataset.testAdapter;

		// Build config from current form values
		const cfg = {
			obsidian: {
				port: Number(portInput.value) || 27124,
				apiKey: apiKeyInput.value.trim(),
				folder: folderInput.value.trim() || "灵感库",
			},
			notion: {
				token: tokenInput.value.trim(),
				databaseId: databaseIdInput.value.trim(),
			},
		};

		const light = document.querySelector(`#status-${id}`);
		const text = document.querySelector(`#status-${id}-text`);

		const r = await ADAPTERS[id].test(cfg[id]);
		if (r.ok) {
			light.className = "status-light ok";
			text.textContent = t("optConnected");
		} else {
			light.className = "status-light bad";
			const errorKey = r.errorKey ?? "errGeneric";
			text.textContent = t(errorKey);
		}
	});
});
