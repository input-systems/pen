import { readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
	missingSelectionReadField,
	noDomSelectionRead,
} from "../rules/noDomSelectionRead.js";

const ruleTester = new RuleTester({
	languageOptions: { parser: tseslint.parser },
});
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const FILE = path.join(
	repoRoot,
	"packages/rendering/dom/src/field-editor/seededReader.ts",
);
const RELATIVE = "packages/rendering/dom/src/field-editor/seededReader.ts";
const entry = {
	file: RELATIVE,
	symbol: "read",
	api: "getSelection",
	reason: "test",
	closedBy: "W3.R4",
};
const none = [{ allowlist: [] }];

describe("pen/no-dom-selection-read", () => {
	it("S1: pen/no-dom-selection-read flags DOM selection reads outside the reader and orphaned allowlist entries", () => {
		ruleTester.run("no-dom-selection-read", noDomSelectionRead, {
			valid: [
				// The authority read is not a DOM read.
				{
					code: "function f() { return editor.getSelection(); }",
					filename: FILE,
					options: none,
				},
				// Event payload is not a DOM read.
				{
					code: "function f(e: InputEvent) { return e.getTargetRanges(); }",
					filename: FILE,
					options: none,
				},
				{
					code: "function f() { el.addEventListener('input', h); }",
					filename: FILE,
					options: none,
				},
				// The reader owns reads.
				{
					code: "function read() { document.addEventListener('selectionchange', h); return window.getSelection(); }",
					filename: path.join(
						repoRoot,
						"packages/rendering/dom/src/field-editor/selectionReader.ts",
					),
					options: none,
				},
				{
					code: "function read() { return window.getSelection(); }",
					filename: FILE,
					options: [{ allowlist: [entry] }],
				},
				// Tests are out of scope.
				{
					code: "function f() { getSelection(); }",
					filename: path.join(
						repoRoot,
						"packages/rendering/react/src/__tests__/x.test.tsx",
					),
					options: none,
				},
			],
			invalid: [
				{
					code: "function f() { getSelection(); }",
					filename: FILE,
					options: none,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f(el: HTMLElement) { el.ownerDocument?.getSelection(); }",
					filename: FILE,
					options: none,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f(el: HTMLElement) { el.ownerDocument.defaultView!.getSelection(); }",
					filename: FILE,
					options: none,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f() { doc.addEventListener('selectionchange', h); }",
					filename: FILE,
					options: none,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f() { document.onselectionchange = h; }",
					filename: FILE,
					options: none,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f(el: HTMLElement) { return getSelectionOffsets(el); }",
					filename: FILE,
					options: none,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function f(root: HTMLElement) { return domSelectionToEditor(root); }",
					filename: FILE,
					options: none,
					errors: [{ messageId: "read" }],
				},
				{
					code: "function other() {}",
					filename: FILE,
					options: [{ allowlist: [entry] }],
					errors: [{ messageId: "orphanedAllowlist" }],
				},
			],
		});
	});

	it("S1: every committed selection-read allowlist entry is complete and closed by a requirement", () => {
		const allowlist = JSON.parse(
			readFileSync(
				path.join(
					repoRoot,
					"scripts/dom-selection-read-allowlist.json",
				),
				"utf8",
			),
		);
		for (const committed of allowlist.entries) {
			expect(
				missingSelectionReadField(committed),
				committed.file,
			).toBeNull();
			expect(committed.closedBy).toMatch(/^W\d+\.R\d+$/);
		}
	});
});
