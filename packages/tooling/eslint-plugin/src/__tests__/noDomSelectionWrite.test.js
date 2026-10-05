import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import { noDomSelectionWrite } from "../rules/noDomSelectionWrite.js";

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const FILE = path.join(repoRoot, "packages/rendering/dom/src/field-editor/seededWriter.ts");

describe("pen/no-dom-selection-write", () => {
	it("S1: pen/no-dom-selection-write flags selection writes outside the projector", () => {
		ruleTester.run("no-dom-selection-write", noDomSelectionWrite, {
			valid: [
				// Range methods are not selection writes.
				{ code: "function f() { const range = document.createRange(); range.collapse(true); }", filename: FILE },
				// The projector owns writes.
				{
					code: "function project() { window.getSelection()?.addRange(r); }",
					filename: path.join(repoRoot, "packages/rendering/dom/src/field-editor/selectionProjector.ts"),
				},
				// Tests are out of scope.
				{
					code: "function f() { getSelection().removeAllRanges(); }",
					filename: path.join(repoRoot, "packages/rendering/dom/src/__tests__/x.test.ts"),
				},
			],
			invalid: [
				{ code: "function f() { getSelection().removeAllRanges(); }", filename: FILE, errors: [{ messageId: "write" }] },
				{ code: "function f() { const s = window.getSelection(); s.collapse(n, 0); }", filename: FILE, errors: [{ messageId: "write" }] },
				{ code: "function f(sel: Selection) { sel.extend(n, 1); }", filename: FILE, errors: [{ messageId: "write" }] },
				{ code: "class B { sync() { this.editContext.updateSelection(0, 0); } }", filename: FILE, errors: [{ messageId: "write" }] },
			],
		});
	});
});
