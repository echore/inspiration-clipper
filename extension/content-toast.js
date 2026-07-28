(function () {
	if (window.__INSP_TOAST_BOUND__) return;
	window.__INSP_TOAST_BOUND__ = true;
	chrome.runtime.onMessage.addListener((msg) => {
		if (msg?.action !== "inspToast") return;
		document.getElementById("insp-toast")?.remove();
		const el = document.createElement("div");
		el.id = "insp-toast";
		el.textContent = msg.text;
		el.style.cssText =
			"position:fixed;right:20px;bottom:20px;z-index:2147483647;" +
			`background:${msg.ok ? "rgba(22,163,74,.94)" : "rgba(220,38,38,.94)"};` +
			"color:#fff;padding:10px 18px;border-radius:10px;" +
			"font:14px/1.5 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);";
		document.body.appendChild(el);
		setTimeout(() => el.remove(), 2400);
	});
})();
