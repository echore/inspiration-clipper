// content-overlay.js — 区域框选遮罩（移植自 Visual Clipper extension/content.js 1-141 行）
(function () {
	// Register the message listener once per document, so a freshly injected
	// script (re-injected on every capture) never accumulates duplicate listeners.
	if (window.__INSP_OVERLAY_BOUND__) return;
	window.__INSP_OVERLAY_BOUND__ = true;

	let overlay, canvas, ctx, hint;
	let state = "idle"; // 'idle' | 'selecting' | 'processing'
	let startX = 0, startY = 0, endX = 0, endY = 0;
	let pendingDataUrl = null; // screenshot held here until region is selected
	let safetyTimer = null;

	function show(dataUrl) {
		// Trust the DOM, not the flag: an SPA re-render can detach the overlay without
		// remove() running, leaving the flag stuck and blocking the next capture.
		if (overlay && overlay.isConnected) return;
		pendingDataUrl = dataUrl || null;

		overlay = document.createElement("div");
		overlay.style.cssText =
			"position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;";

		canvas = document.createElement("canvas");
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		canvas.style.cssText = "position:absolute;inset:0;";
		ctx = canvas.getContext("2d");

		hint = document.createElement("div");
		hint.style.cssText =
			"position:absolute;bottom:16px;left:50%;transform:translateX(-50%);" +
			"background:rgba(0,0,0,.75);color:#fff;padding:6px 16px;border-radius:20px;" +
			"font:13px/1.6 system-ui,sans-serif;pointer-events:none;white-space:nowrap;";
		hint.textContent = "拖动框选要收藏的区域，Esc 取消";

		overlay.append(canvas, hint);
		document.body.appendChild(overlay);

		// Initial dim
		ctx.fillStyle = "rgba(0,0,0,.4)";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		overlay.addEventListener("mousedown", onDown);
		overlay.addEventListener("mousemove", onMove);
		overlay.addEventListener("mouseup", onUp);
		// The crop is cut from a screenshot taken before the overlay showed; any
		// scroll while framing would desync what the user sees from what gets saved.
		overlay.addEventListener("wheel", blockScroll, { passive: false });
		overlay.addEventListener("touchmove", blockScroll, { passive: false });
		document.addEventListener("keydown", onKey, true);
		state = "idle";
	}

	function draw() {
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = "rgba(0,0,0,.4)";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		const x = Math.min(startX, endX), y = Math.min(startY, endY);
		const w = Math.abs(endX - startX), h = Math.abs(endY - startY);
		if (w < 2 || h < 2) return;

		// Punch hole in dim for selection
		ctx.clearRect(x, y, w, h);
		// Selection border
		ctx.strokeStyle = "#6366f1";
		ctx.lineWidth = 2;
		ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
		// Tint selection
		ctx.fillStyle = "rgba(99,102,241,.12)";
		ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
		// Size label
		const label = `${Math.round(w)} × ${Math.round(h)}`;
		ctx.font = "bold 11px monospace";
		const lw = ctx.measureText(label).width + 10;
		ctx.fillStyle = "#6366f1";
		ctx.fillRect(x, Math.max(0, y - 22), lw, 22);
		ctx.fillStyle = "#fff";
		ctx.fillText(label, x + 5, Math.max(15, y - 6));
	}

	function remove() {
		document.removeEventListener("keydown", onKey, true);
		clearTimeout(safetyTimer);
		safetyTimer = null;
		if (overlay) overlay.remove();
		pendingDataUrl = null;
		state = "idle";
	}

	function onDown(e) {
		if (state !== "idle") return;
		e.preventDefault();
		state = "selecting";
		startX = endX = e.clientX;
		startY = endY = e.clientY;
	}

	function onMove(e) {
		if (state !== "selecting") return;
		endX = e.clientX; endY = e.clientY;
		draw();
	}

	function onUp(e) {
		if (state !== "selecting") return;
		endX = e.clientX; endY = e.clientY;
		const x = Math.min(startX, endX), y = Math.min(startY, endY);
		const w = Math.abs(endX - startX), h = Math.abs(endY - startY);
		if (w < 10 || h < 10) { state = "idle"; draw(); return; }

		state = "processing";
		hint.textContent = "保存中…";

		// Safety: reset to idle if background never replies (crash / connection loss).
		// Cleared only by the real completion signal (inspCaptureDone → remove()),
		// not by the sendMessage callback below, which fires as soon as the message
		// channel closes and says nothing about whether the capture actually finished.
		safetyTimer = setTimeout(() => {
			if (state === "processing") {
				state = "idle";
				hint.textContent = "超时了，重试一下";
				hint.style.background = "rgba(239,68,68,.85)";
			}
		}, 15000);

		chrome.runtime.sendMessage({
			action: "inspRegionSelected",
			rect: { x, y, width: w, height: h },
			dpr: window.devicePixelRatio || 1,
			source_url: location.href,
			title: document.title,
			dataUrl: pendingDataUrl, // pass screenshot back to background
		}, () => void chrome.runtime.lastError); // no response expected; silence the unchecked-lastError warning
	}

	function blockScroll(e) {
		e.preventDefault();
	}

	const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "]);

	function onKey(e) {
		if (e.key === "Escape") remove();
		else if (SCROLL_KEYS.has(e.key)) e.preventDefault();
	}

	// Listen for messages from background
	chrome.runtime.onMessage.addListener((msg) => {
		if (msg?.action === "inspShowOverlay") show(msg.dataUrl);
		if (msg?.action === "inspCaptureDone") remove();
	});
})();
