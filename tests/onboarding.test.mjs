import { test } from "node:test";
import assert from "node:assert/strict";
import {
	sanitizeToken, flowFor, nextStep, prevStep, firstCredentialStep, stepNumber,
} from "../extension/lib/onboarding.js";

test("sanitizeToken passes a clean token through", () => {
	assert.equal(sanitizeToken("ntn_abc123"), "ntn_abc123");
});
test("sanitizeToken strips whitespace and wrapping angle brackets", () => {
	// 实际事故:用户从带占位符的指引里复制,token 被 <> 包住
	assert.equal(sanitizeToken("  <ntn_abc123>  "), "ntn_abc123");
	assert.equal(sanitizeToken("<<ntn_x>>"), "ntn_x");
	assert.equal(sanitizeToken("\tntn_y\n"), "ntn_y");
});
test("sanitizeToken tolerates non-string input", () => {
	assert.equal(sanitizeToken(null), "");
	assert.equal(sanitizeToken(undefined), "");
});

test("flowFor returns each destination's branch (obsidian 3 steps, notion 2)", () => {
	assert.deepEqual(flowFor("obsidian"), ["obsidian-install", "obsidian-connect", "obsidian-folder"]);
	assert.deepEqual(flowFor("notion"), ["notion-token", "notion-connect"]);
	assert.deepEqual(flowFor(""), []);
});

test("nextStep walks choose → branch → done", () => {
	assert.equal(nextStep("obsidian", "choose"), "obsidian-install");
	assert.equal(nextStep("obsidian", "obsidian-install"), "obsidian-connect");
	assert.equal(nextStep("obsidian", "obsidian-folder"), "done");
	assert.equal(nextStep("notion", "choose"), "notion-token");
	assert.equal(nextStep("notion", "notion-connect"), "done");
	assert.equal(nextStep("notion", "not-a-step"), null);
});

test("prevStep walks branch → choose and never past it", () => {
	assert.equal(prevStep("obsidian", "obsidian-install"), "choose");
	assert.equal(prevStep("notion", "notion-connect"), "notion-token");
	assert.equal(prevStep("notion", "not-a-step"), null);
});

test("firstCredentialStep skips the install step for reconfiguration", () => {
	// 老用户重新配置不需要再看"装插件"
	assert.equal(firstCredentialStep("obsidian"), "obsidian-connect");
	assert.equal(firstCredentialStep("notion"), "notion-token");
});

test("stepNumber is 1-based within the branch, 0 outside it", () => {
	assert.equal(stepNumber("obsidian", "obsidian-install"), 1);
	assert.equal(stepNumber("obsidian", "obsidian-folder"), 3);
	assert.equal(stepNumber("notion", "notion-connect"), 2);
	assert.equal(stepNumber("notion", "choose"), 0);
	assert.equal(stepNumber("notion", "done"), 0);
});
