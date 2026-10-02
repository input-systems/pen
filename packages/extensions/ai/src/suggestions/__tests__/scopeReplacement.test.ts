import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { describe, expect, it } from "vitest";
import { aiSuggestionsExtension, getAISuggestionsController } from "../index";
import type { AISuggestionCandidate } from "../types";

async function flushTimers(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await Promise.resolve();
}

const CANDIDATES: readonly AISuggestionCandidate[] = [
	{
		kind: "spelling",
		title: "Spelling",
		originalText: "Ths",
		replacementText: "This",
		confidence: 0.99,
	},
	{
		kind: "spelling",
		title: "Spelling",
		originalText: "recieve",
		replacementText: "receive",
		confidence: 0.99,
	},
	{
		kind: "spelling",
		title: "Spelling",
		originalText: "teh",
		replacementText: "the",
		confidence: 0.99,
	},
];

// answers with every known misspelling that appears in the analyzed scope
function createScopedEditor() {
	return createEditor({
		schema: defaultSchema,
		extensions: [
			aiSuggestionsExtension({
				debounceMs: 0,
				minStableMs: 0,
				minChangedChars: 1,
				cooldownMs: 0,
				analyzer: {
					async analyze({ scope }) {
						return {
							candidates: CANDIDATES.filter((candidate) =>
								scope.text.includes(candidate.originalText),
							),
						};
					},
				},
			}),
		],
	});
}

function typeText(
	editor: ReturnType<typeof createScopedEditor>,
	blockId: string,
	offset: number,
	text: string,
): void {
	editor.apply(
		[
			{
				type: "splice-text",
				blockId,
				from: offset,
				to: offset,
				insert: text,
			},
		],
		{ origin: "user" },
	);
}

function liveOriginalTexts(
	editor: ReturnType<typeof createScopedEditor>,
): string[] {
	return getAISuggestionsController(editor)!
		.getState()
		.suggestions.filter((suggestion) => !suggestion.invalidated)
		.map((suggestion) => suggestion.originalText)
		.sort();
}

describe("suggestion replacement is scoped to the analyzed sentence", () => {
	it("keeps an earlier sentence's suggestions when a later sentence in the same block is analyzed", async () => {
		const editor = createScopedEditor();
		const blockId = editor.firstBlock()!.id;

		const first = "Ths sentence works.";
		typeText(editor, blockId, 0, first);
		await flushTimers();
		expect(liveOriginalTexts(editor)).toEqual(["Ths"]);

		// the scope anchors on the last edit, so finish the second sentence with its own keystroke
		const second = " We recieve mail";
		typeText(editor, blockId, first.length, second);
		typeText(editor, blockId, first.length + second.length, ".");
		await flushTimers();

		expect(liveOriginalTexts(editor)).toEqual(["Ths", "recieve"]);
		expect(editor.getDecorations().decorations).toHaveLength(2);

		editor.destroy();
	});

	it("replaces only the suggestions inside the re-analyzed sentence and keeps the rest anchored", async () => {
		const editor = createScopedEditor();
		const blockId = editor.firstBlock()!.id;

		const text = "Ths sentence works. We recieve mail.";
		typeText(editor, blockId, 0, text);
		await flushTimers();
		expect(liveOriginalTexts(editor)).toEqual(["Ths"]);

		const secondSentenceOffset = "Ths sentence works. We recieve".length;
		typeText(editor, blockId, secondSentenceOffset, " teh");
		await flushTimers();
		expect(liveOriginalTexts(editor)).toEqual(["Ths", "recieve", "teh"]);

		// re-analyzing the second sentence must not touch the first sentence's suggestion
		typeText(
			editor,
			blockId,
			secondSentenceOffset + " teh".length,
			" again",
		);
		await flushTimers();
		expect(liveOriginalTexts(editor)).toEqual(["Ths", "recieve", "teh"]);

		const blockText = editor
			.getBlock(blockId)!
			.textContent({ resolved: true });
		for (const suggestion of getAISuggestionsController(editor)!.getState()
			.suggestions) {
			expect(blockText.slice(suggestion.from, suggestion.to)).toBe(
				suggestion.originalText,
			);
		}

		editor.destroy();
	});
});
