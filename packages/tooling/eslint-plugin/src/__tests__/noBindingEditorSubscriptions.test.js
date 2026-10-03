import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import {
	missingSubscriptionAllowlistField,
	noBindingEditorSubscriptions,
} from "../rules/noBindingEditorSubscriptions.js";

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
const RELATIVE = "packages/rendering/react/src/hooks/useExample.ts";
const FILE = path.join(repoRoot, RELATIVE);

const perBlock = `
export function useBlockThing(editor, blockId) {
	return useSyncExternalStore(
		(callback) => editor.on("commit", () => callback()),
		() => editor.getBlock(blockId),
	);
}
`;
const shorthand = `
export function useCaretThing(editor) {
	useEffect(() => editor.onSelectionChange(() => {}), [editor]);
}
`;
const notified = `
export function useBlockThing(editor, blockId) {
	const notifier = useBlockNotifier();
	editor.on("decorationsChange", () => {});
	return useSyncExternalStore((onChange) => notifier.subscribeBlock(blockId, onChange), () => null);
}
`;
const entry = { file: RELATIVE, symbol: "useBlockThing", reason: "test" };

describe("pen/no-binding-editor-subscriptions", () => {
	it("HB2: a binding per-block editor subscription outside the allowlist fails", () => {
		ruleTester.run("no-binding-editor-subscriptions", noBindingEditorSubscriptions, {
			valid: [
				{ code: notified, filename: FILE, options: [{ allowlist: [] }] },
				{ code: perBlock, filename: FILE, options: [{ allowlist: [entry] }] },
			],
			invalid: [
				{
					code: perBlock,
					filename: FILE,
					options: [{ allowlist: [] }],
					errors: [
						{
							messageId: "subscription",
							data: { event: "commit", symbol: "useBlockThing", file: RELATIVE },
						},
					],
				},
				{
					code: shorthand,
					filename: FILE,
					options: [{ allowlist: [] }],
					errors: [
						{
							messageId: "subscription",
							data: { event: "selectionChange", symbol: "useCaretThing", file: RELATIVE },
						},
					],
				},
				{
					code: notified,
					filename: FILE,
					options: [{ allowlist: [entry] }],
					errors: [{ messageId: "orphanedAllowlist" }],
				},
				{
					code: perBlock,
					filename: FILE,
					options: [{ allowlist: [{ ...entry, reason: "" }] }],
					errors: [{ messageId: "incompleteAllowlist" }, { messageId: "subscription" }],
				},
			],
		});
	});

	it("HB2: every committed allowlist entry is complete, names a live file, and a closedBy names a W-requirement", () => {
		const allowlist = JSON.parse(
			readFileSync(path.join(repoRoot, "scripts/binding-subscriptions-allowlist.json"), "utf8"),
		);
		expect(allowlist.entries.length).toBeGreaterThan(0);
		for (const committed of allowlist.entries) {
			expect(missingSubscriptionAllowlistField(committed), committed.file).toBeNull();
			expect(committed.file).toMatch(/^packages\/rendering\/(react|vue)\/src\//);
			expect(existsSync(path.join(repoRoot, committed.file)), committed.file).toBe(true);
			if (committed.closedBy !== undefined) {
				expect(committed.closedBy).toMatch(/^W\d+\.R\d+$/);
			}
		}
	});
});
