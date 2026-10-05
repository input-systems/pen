import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import { noDirectDomFocus } from "../rules/noDirectDomFocus.js";

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const FILE = path.join(repoRoot, "packages/rendering/dom/src/utils/seededFocus.ts");

describe("pen/no-direct-dom-focus", () => {
	it("P: flags element.focus outside focusController.ts; fieldEditor.focus is allowed", () => {
		ruleTester.run("no-direct-dom-focus", noDirectDomFocus, {
			valid: [
				{ code: "function f(fieldEditor) { fieldEditor.focus(); }", filename: FILE },
				{ code: "function f(ctx) { ctx.fieldEditor?.focus(); }", filename: FILE },
				{ code: "class F { refocus() { this.focus(); } }", filename: FILE },
				{
					code: "function request(target) { target.focus({ preventScroll: true }); }",
					filename: path.join(repoRoot, "packages/rendering/dom/src/field-editor/focusController.ts"),
				},
				// React and Vue chrome focus their own controls (AX3).
				{
					code: "function f(button) { button.focus(); }",
					filename: path.join(repoRoot, "packages/rendering/react/src/primitives/toolbar.tsx"),
				},
				// Tests are out of scope.
				{
					code: "function f(el) { el.focus(); }",
					filename: path.join(repoRoot, "packages/rendering/dom/src/__tests__/x.test.ts"),
				},
			],
			invalid: [
				{ code: "function f(root) { root.focus({ preventScroll: true }); }", filename: FILE, errors: [{ messageId: "focus" }] },
				{ code: "function f(sink) { sink.element?.focus(); }", filename: FILE, errors: [{ messageId: "focus" }] },
			],
		});
	});
});
