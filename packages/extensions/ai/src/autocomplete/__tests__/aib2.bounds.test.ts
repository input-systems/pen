import { describe, expect, it } from "vitest";
import { createEditor, getInlineCompletionController } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { createModelDouble } from "@input/pen-test";
import {
	autocompleteExtension,
	createAutocompleteProvider,
	getAutocompleteController,
} from "../index";
import {
	DEFAULT_MAX_NEIGHBOR_CHARS,
	DEFAULT_MAX_PREFIX_CHARS,
	DEFAULT_MAX_PROVIDER_CHARS,
	DEFAULT_MAX_SUFFIX_CHARS,
} from "../constants";
import { fieldEditorSlot, waitForCondition } from "./extension.testHelpers";

function readPromptField(user: string, key: string): string | null {
	const line = user.split("\n").find((entry) => entry.startsWith(`${key}=`));
	if (!line) {
		return null;
	}
	return JSON.parse(line.slice(key.length + 1)) as string;
}

function readProviderText(user: string, id: string): string {
	const marker = `[provider:${id}]\n`;
	const start = user.indexOf(marker);
	if (start < 0) {
		return "";
	}
	const rest = user.slice(start + marker.length);
	const next = rest.search(/\n\[provider:/);
	return next < 0 ? rest : rest.slice(0, next);
}

describe("AIB2 autocomplete send bounds", () => {
	it("AIB2: prefix, suffix, neighbor, and provider text stay within the exported char caps", async () => {
		const slot = fieldEditorSlot();
		const double = createModelDouble({
			responses: [{ text: " world" }],
		});
		const oversizedPrefix = "P".repeat(DEFAULT_MAX_PREFIX_CHARS * 3);
		const oversizedSuffix = "S".repeat(DEFAULT_MAX_SUFFIX_CHARS * 3);
		const oversizedPrev = "N".repeat(DEFAULT_MAX_NEIGHBOR_CHARS * 3);
		const oversizedNext = "M".repeat(DEFAULT_MAX_NEIGHBOR_CHARS * 3);
		const oversizedProvider = "H".repeat(DEFAULT_MAX_PROVIDER_CHARS * 4);

		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: double,
					providers: [
						createAutocompleteProvider({
							id: "huge",
							priority: 1000,
							provide: () => oversizedProvider,
						}),
					],
				}),
				slot.extension,
			],
		});

		const prevBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: prevBlockId,
					from: 0,
					to: 0,
					insert: oversizedPrev,
				},
			],
			{ origin: "user" },
		);

		const targetBlockId = crypto.randomUUID();
		const nextBlockId = crypto.randomUUID();
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: targetBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: prevBlockId },
				},
				{
					type: "splice-text",
					blockId: targetBlockId,
					from: 0,
					to: 0,
					insert: `${oversizedPrefix}${oversizedSuffix}`,
				},
				{
					type: "insert-block",
					blockId: nextBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: targetBlockId },
				},
				{
					type: "splice-text",
					blockId: nextBlockId,
					from: 0,
					to: 0,
					insert: oversizedNext,
				},
			],
			{ origin: "user" },
		);

		slot.fieldEditor.focusBlockId = targetBlockId;
		editor.selectText(
			targetBlockId,
			oversizedPrefix.length,
			oversizedPrefix.length,
		);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" world",
		);

		expect(double.requests).toHaveLength(1);
		const recorded = double.requests[0]!;
		expect(recorded.feature).toBe("autocomplete");

		const user = String(recorded.messages[1]?.content ?? "");
		const prefix = readPromptField(user, "prefix");
		const suffix = readPromptField(user, "suffix");
		const previous = readPromptField(user, "previous_block");
		const next = readPromptField(user, "next_block");
		const providerText = readProviderText(user, "huge");

		expect(prefix).toBeTruthy();
		expect(suffix).toBeTruthy();
		expect(previous).toBeTruthy();
		expect(next).toBeTruthy();
		expect(prefix!.length).toBe(DEFAULT_MAX_PREFIX_CHARS);
		expect(suffix!.length).toBe(DEFAULT_MAX_SUFFIX_CHARS);
		expect(previous!.length).toBe(DEFAULT_MAX_NEIGHBOR_CHARS);
		expect(next!.length).toBe(DEFAULT_MAX_NEIGHBOR_CHARS);
		expect(providerText.length).toBeLessThanOrEqual(
			DEFAULT_MAX_PROVIDER_CHARS,
		);
		expect(providerText.length).toBeGreaterThan(0);
		expect(providerText.length).toBeLessThan(oversizedProvider.length);

		const target = recorded.documentExcerpts.find(
			(excerpt) => excerpt.kind === "target",
		);
		expect(target?.text.length).toBeLessThanOrEqual(
			DEFAULT_MAX_PREFIX_CHARS + DEFAULT_MAX_SUFFIX_CHARS,
		);
		for (const excerpt of recorded.documentExcerpts) {
			if (excerpt.kind === "context") {
				expect(excerpt.text.length).toBeLessThanOrEqual(
					DEFAULT_MAX_NEIGHBOR_CHARS,
				);
			}
		}

		expect(user).not.toContain(oversizedPrefix);
		expect(user).not.toContain(oversizedSuffix);
		expect(user).not.toContain(oversizedPrev);
		expect(user).not.toContain(oversizedNext);
		expect(user).not.toContain(oversizedProvider);

		editor.destroy();
	});
});
