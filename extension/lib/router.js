// Router: decide where this capture goes.
// Pure function, no chrome API, no fetch.
// Strategy lives here, not in adapters: adapters only answer "can I store this",
// "if I can't, where should it go" is a strategy question.

export function chooseDestination(item, chain, capsById) {
	if (!chain || chain.length === 0) return { error: "noDestination" };

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

	return {
		error: "tooLargeForAll",
		byteLength: item.byteLength,
		maxFileSize: firstLimit ?? 0,
	};
}
