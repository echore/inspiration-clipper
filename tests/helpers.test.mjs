import { test } from "node:test";
import assert from "node:assert/strict";
import { HELPERS_READY } from "../extension/lib/helpers.js";

test("test infra runs", () => {
	assert.equal(HELPERS_READY, true);
});
