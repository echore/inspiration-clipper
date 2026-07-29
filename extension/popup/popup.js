import { loadSettings } from "../lib/settings.js";
import { ADAPTERS } from "../lib/adapters/index.js";
import { t } from "../lib/i18n.js";

// Fill in i18n text
document.querySelectorAll("[data-i18n]").forEach((el) => {
	el.textContent = t(el.dataset.i18n);
});

const destinationsDiv = document.querySelector("#destinations");
const notConfiguredDiv = document.querySelector("#notConfigured");
const openOptionsBtn = document.querySelector("#openOptions");
const captureBtn = document.querySelector("#capture");

// Load settings and render destinations
(async () => {
	const settings = await loadSettings();

	if (!settings.chain || settings.chain.length === 0) {
		// No destinations configured
		notConfiguredDiv.style.display = "block";
		openOptionsBtn.style.display = "block";
		captureBtn.disabled = true;
		return;
	}

	// Test each adapter in the chain
	for (const adapterId of settings.chain) {
		const adapter = ADAPTERS[adapterId];
		if (!adapter) continue;

		const cfg = settings.byAdapter[adapterId];
		const result = await adapter.test(cfg);

		const destName = t(`dest_${adapterId}`);
		const row = document.createElement("div");

		if (result.ok) {
			row.innerHTML = `
				<div class="dest-row">
					<span class="dest-light ok"></span>
					<span class="dest-name">${destName}</span>
				</div>
			`;
		} else {
			const errorMsg = t(result.errorKey ?? "errGeneric");
			row.innerHTML = `
				<div class="dest-row">
					<span class="dest-light bad"></span>
					<span class="dest-name">${destName}</span>
				</div>
				<div class="dest-error">${errorMsg}</div>
			`;
		}

		destinationsDiv.appendChild(row);
	}

	// Enable capture if at least one destination is OK
	captureBtn.disabled = false;
})();

// Open options page
openOptionsBtn.addEventListener("click", () => {
	chrome.runtime.openOptionsPage();
});

// Capture region
captureBtn.addEventListener("click", () => {
	chrome.runtime.sendMessage({ action: "inspStartCapture" });
	window.close();
});
