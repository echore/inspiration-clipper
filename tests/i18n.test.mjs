import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const en = JSON.parse(readFileSync(new URL("../extension/_locales/en/messages.json", import.meta.url)));
const zh = JSON.parse(readFileSync(new URL("../extension/_locales/zh_CN/messages.json", import.meta.url)));

test("both locales define exactly the same keys", () => {
	assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});
test("every message has a non-empty string", () => {
	for (const [k, v] of Object.entries({ ...en, ...zh })) {
		assert.equal(typeof v.message, "string", `${k} missing message`);
		assert.ok(v.message.length > 0, `${k} is empty`);
	}
});
test("placeholder counts match across locales", () => {
	for (const k of Object.keys(en)) {
		const count = (s) => (s.match(/\$\d/g) || []).length;
		assert.equal(count(en[k].message), count(zh[k].message), `${k} placeholder mismatch`);
	}
});
