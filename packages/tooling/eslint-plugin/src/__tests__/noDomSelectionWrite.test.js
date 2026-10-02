import { readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
	missingSelectionWriteField,
	noDomSelectionWrite,
} from "../rules/noDomSelectionWrite.js";

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const FILE = path.join(repoRoot, "packages/rendering/dom/src/field-editor/seededWriter.ts");
const RELATIVE = "packages/rendering/dom/src/field-editor/seededWriter.ts";
const entry = { file: RELATIVE, symbol: "write", api: "addRange", reason: "test", closedBy: "W3.R3" };

describe("pen/no-dom-selection-write", () => {
	it("S1: pen/no-dom-selection-write flags selection writes outside the projector and orphaned allowlist entries", () => {
		ruleTester.run("no-dom-selection-write", noDomSelectionWrite, {
			valid: [
				// Range methods are not selection writes.
				{ code: "function f() { const range = document.createRange(); range.collapse(true); }", filename: FILE, options: [{ allowlist: [] }] },
				// The projector owns writes.
				{
					code: "function project() { window.getSelection()?.addRange(r); }",
					filename: path.join(repoRoot, "packages/rendering/dom/src/field-editor/selectionProjector.ts"),
					options: [{ allowlist: [] }],
				},
				{ code: "function write() { getSelection().addRange(r); }", filename: FILE, options: [{ allowlist: [entry] }] },
				// Tests are out of scope.
				{
					code: "function f() { getSelection().removeAllRanges(); }",
					filename: path.join(repoRoot, "packages/rendering/dom/src/__tests__/x.test.ts"),
					options: [{ allowlist: [] }],
				},
			],
			invalid: [
				{ code: "function f() { getSelection().removeAllRanges(); }", filename: FILE, options: [{ allowlist: [] }], errors: [{ messageId: "write" }] },
				{ code: "function f() { const s = window.getSelection(); s.collapse(n, 0); }", filename: FILE, options: [{ allowlist: [] }], errors: [{ messageId: "write" }] },
				{ code: "function f(sel: Selection) { sel.extend(n, 1); }", filename: FILE, options: [{ allowlist: [] }], errors: [{ messageId: "write" }] },
				{ code: "class B { sync() { this.editContext.updateSelection(0, 0); } }", filename: FILE, options: [{ allowlist: [] }], errors: [{ messageId: "write" }] },
				{ code: "function other() {}", filename: FILE, options: [{ allowlist: [entry] }], errors: [{ messageId: "orphanedAllowlist" }] },
			],
		});
	});

	it("S1: every committed selection-write allowlist entry is complete and closed by a W3 requirement", () => {
		const allowlist = JSON.parse(
			readFileSync(path.join(repoRoot, "scripts/dom-selection-write-allowlist.json"), "utf8"),
		);
		for (const committed of allowlist.entries) {
			expect(missingSelectionWriteField(committed), committed.file).toBeNull();
			expect(committed.closedBy).toMatch(/^W\d+\.R\d+$/);
		}
	});
});
