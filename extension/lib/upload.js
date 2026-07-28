import { LOCAL } from "../config.local.js";

export async function upload(body) {
	let res;
	try {
		res = await fetch(`http://localhost:${LOCAL.port}/api/upload`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(LOCAL.apiKey ? { Authorization: `Bearer ${LOCAL.apiKey}` } : {}),
			},
			body: JSON.stringify(body),
		});
	} catch (e) {
		throw { networkError: true };
	}
	if (!res.ok) throw { status: res.status };
}

export async function ping() {
	try {
		const res = await fetch(`http://localhost:${LOCAL.port}/api/ping`, {
			headers: LOCAL.apiKey ? { Authorization: `Bearer ${LOCAL.apiKey}` } : {},
		});
		return res.ok;
	} catch {
		return false;
	}
}
