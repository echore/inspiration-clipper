// extension/popup/popup.js
const light = document.getElementById("light");
const status = document.getElementById("status");
const hint = document.getElementById("hint");
const btn = document.getElementById("capture");

chrome.runtime.sendMessage({ action: "inspPing" }, (resp) => {
	if (resp?.ok) {
		light.className = "light ok";
		status.textContent = "已连接 Obsidian 灵感库";
		hint.textContent = "";
		btn.disabled = false;
	} else {
		light.className = "light bad";
		status.textContent = "连不上灵感库";
		hint.textContent = "打开 Obsidian 的 creation-flywheel 仓库就能用；开着还不行就重开一次 Media Companion 插件。";
	}
});

btn.addEventListener("click", () => {
	chrome.runtime.sendMessage({ action: "inspStartCapture" });
	window.close();
});
