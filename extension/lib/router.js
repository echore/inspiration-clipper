// Router: decide where this capture goes.
// Pure function, no chrome API, no fetch.
// Strategy lives here, not in adapters: adapters only answer "can I store this",
// "if I can't, where should it go" is a strategy question.
//
// When NO destination in the chain has known capabilities (all are unprobed/unreachable),
// attempt the preferred destination (chain[0]) so the adapter's save() can surface the
// precise error (e.g. "Obsidian isn't running") instead of a misleading "0 MB" toast.
// This only applies to the all-unknown case; if some destinations have known limits
// but none fit, tooLargeForAll is still returned (that error is accurate).

export function chooseDestination(item, chain, capsById) {
	if (!chain || chain.length === 0) return { error: "noDestination" };

	// Guard against null/undefined capsById; treat as empty object.
	capsById = capsById || {};

	let firstLimit = null;
	let degradedFrom = null;

	for (const id of chain) {
		const caps = capsById[id];
		// Unknown capabilities = not connected or not probed yet. Skip rather than guess ——
		// guessing wrong means a silently dropped capture.
		if (!caps) {
			if (degradedFrom === null) degradedFrom = id;
			continue;
		}
		if (firstLimit === null) firstLimit = caps.maxFileSize;
		if (item.byteLength <= caps.maxFileSize) {
			return { adapterId: id, degradedFrom };
		}
		if (degradedFrom === null) degradedFrom = id;
	}

	// If no destination had known capabilities, attempt the preferred destination
	// so the adapter can surface the precise error (connection failure, etc).
	if (firstLimit === null) {
		return { adapterId: chain[0], degradedFrom: null };
	}

	return {
		error: "tooLargeForAll",
		byteLength: item.byteLength,
		maxFileSize: firstLimit ?? 0,
	};
}
