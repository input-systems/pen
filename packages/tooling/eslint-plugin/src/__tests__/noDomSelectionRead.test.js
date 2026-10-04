import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import { noDomSelectionRead } from "../rules/noDomSelectionRead.js";

const ruleTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const FILE = path.join(
	repoRoot,
	"packages/rendering/dom/src/field-editor/seededReader.ts",
);

describe("pen/no-dom-selection-read", () => {
	it("S1: pen/no-dom-selection-read flags DOM selection reads outside the reader", () => {
		ruleTester.run("no-dom-selection-read", noDomSelectionRead, {
			valid: [
				// The authority read is not a DOM read.
				{
					code: "function f() { return editor.getSelection(); }",
					filename: FILE,
				},
				// Event payload is not a DOM read.
				{
					code: "function f(e: InputEvent) { return e.getTargetRanges(); }",
					filename: FILE,
				},
				{
					code: "function f() { el.addEventListener('input', h); }",
					filename: FILE,
				},
				// The reader owns reads.
				{
					code: "function read() { document.addEventListener('selectionchange', h); return window.getSelection(); }",
					filename: path.join(
						repoRoot,
						"packages/rendering/dom/src/field-editor/selectionReader.ts",
					),
				},
				// The writer takes its Selection from the reader's handle.
				{
					code: "function write(root) { return nativeSelectionForWrite(root); }",
					filename: path.join(
						repoRoot,
						"packages/rendering/dom/src/field-editor/selectionProjector.ts",
					),
				},
				// Tests are out of scope.
				{
					code: "function f() { getSelection(); }",
					filename: path.join(
						repoRoot,
						"packages/rendering/react/src/__tests__/x.test.tsx",
					),
				},
			],
			invalid: [
				// Only the writer may take the Selection through the handle.
				{
					code: "function f(el) { return nativeSelectionForWrite(el); }",
					filename: FILE,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f() { getSelection(); }",
					filename: FILE,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f(el: HTMLElement) { el.ownerDocument?.getSelection(); }",
					filename: FILE,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f(el: HTMLElement) { el.ownerDocument.defaultView!.getSelection(); }",
					filename: FILE,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f() { doc.addEventListener('selectionchange', h); }",
					filename: FILE,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f() { document.onselectionchange = h; }",
					filename: FILE,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f(el: HTMLElement) { return getSelectionOffsets(el); }",
					filename: FILE,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f(root: HTMLElement) { return domSelectionToEditor(root); }",
					filename: FILE,
					errors: [{ messageId: "read" }],
				},
			],
		});
	});
});
