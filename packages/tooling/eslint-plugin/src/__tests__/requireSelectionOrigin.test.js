import { readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
	missingOriginAllowlistField,
	requireSelectionOrigin,
} from "../rules/requireSelectionOrigin.js";

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const RELATIVE = "packages/rendering/dom/src/seededOrigin.ts";
const FILE = path.join(repoRoot, RELATIVE);
const entry = { file: RELATIVE, symbol: "forward", setter: "selectBlock", reason: "host API forwarding" };
const none = [{ allowlist: [] }];

describe("pen/require-selection-origin", () => {
	it("S3: pen/require-selection-origin flags originless editor setter calls and orphaned allowlist entries", () => {
		ruleTester.run("require-selection-origin", requireSelectionOrigin, {
			valid: [
				{ code: "function b(editor) { editor.selectBlock('x', { origin: 'keyboard' }); }", filename: FILE, options: none },
				// A scheduler is not an editor.
				{ code: "function c(scheduler) { scheduler.setSelection(record); }", filename: FILE, options: none },
				{ code: "class F { focus() { this._editor.selectText('x', 0, 0, { origin: 'pointer' }); } }", filename: FILE, options: none },
				{ code: "function forward(editor) { editor.selectBlock('x'); }", filename: FILE, options: [{ allowlist: [entry] }] },
			],
			invalid: [
				{ code: "function a(editor) { editor.selectBlock('x'); }", filename: FILE, options: none, errors: [{ messageId: "originless", data: { setter: "selectBlock", symbol: "a", file: RELATIVE } }] },
				{ code: "function d(ctx) { ctx.editor.selectText('x', 0, 0); }", filename: FILE, options: none, errors: [{ messageId: "originless" }] },
				{ code: "class F { set selection(value) { this.ed.setSelection(value); } }", filename: FILE, options: none, errors: [{ messageId: "originless", data: { setter: "setSelection", symbol: "selection", file: RELATIVE } }] },
				{ code: "function other() {}", filename: FILE, options: [{ allowlist: [entry] }], errors: [{ messageId: "orphanedAllowlist" }] },
				{
					code: "function forward(editor) { editor.selectBlock('x'); }",
					filename: FILE,
					options: [{ allowlist: [{ ...entry, reason: "" }] }],
					errors: [{ messageId: "incompleteAllowlist" }, { messageId: "originless" }],
				},
			],
		});
	});

	it("S3: every committed selection-origin allowlist entry is complete", () => {
		const allowlist = JSON.parse(
			readFileSync(path.join(repoRoot, "scripts/selection-origin-allowlist.json"), "utf8"),
		);
		for (const committed of allowlist.entries) {
			expect(missingOriginAllowlistField(committed), committed.file).toBeNull();
		}
	});
});
