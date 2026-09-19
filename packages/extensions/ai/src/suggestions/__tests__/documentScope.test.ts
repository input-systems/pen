import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { BlockHandle } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import { aiSuggestionsExtension, getAISuggestionsController } from "../index";
import { DOCUMENT_SCOPE_BLOCK_SEPARATOR } from "../scopeBuilder";
import type { AISuggestionCandidate, AISuggestionsBlockPolicy } from "../types";

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
];

function createDocumentEditor(options?: {
	blockPolicy?: AISuggestionsBlockPolicy;
	onAnalyze?: (text: string) => void;
}) {
	return createEditor({
		schema: defaultSchema,
		extensions: [
			aiSuggestionsExtension({
				debounceMs: 0,
				minStableMs: 0,
				minChangedChars: 1,
				cooldownMs: 0,
				scopeUnit: "document",
				blockPolicy: options?.blockPolicy,
				analyzer: {
					async analyze({ scope }) {
						options?.onAnalyze?.(scope.text);
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

function insertParagraphAfter(
	editor: ReturnType<typeof createDocumentEditor>,
	afterBlockId: string,
	text: string,
): string {
	const blockId = `block-${text.length}-${Math.random().toString(36).slice(2, 8)}`;
	editor.apply(
		[
			{
				type: "insert-block",
				blockId,
				blockType: "paragraph",
				props: {},
				position: { after: afterBlockId },
			},
			{ type: "splice-text", blockId, from: 0, to: 0, insert: text },
		],
		{ origin: "user" },
	);
	return blockId;
}

describe("document scope", () => {
	it("analyzes every paragraph in one request and anchors each suggestion in its own block", async () => {
		const analyzedTexts: string[] = [];
		const editor = createDocumentEditor({
			onAnalyze: (text) => analyzedTexts.push(text),
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: firstBlockId,
					from: 0,
					to: 0,
					insert: "Ths sentence works.",
				},
			],
			{ origin: "user" },
		);
		const secondBlockId = insertParagraphAfter(
			editor,
			firstBlockId,
			"We recieve mail.",
		);

		await flushTimers();

		const controller = getAISuggestionsController(editor)!;
		const suggestions = controller.getState().suggestions;
		expect(analyzedTexts.at(-1)).toBe(
			`Ths sentence works.${DOCUMENT_SCOPE_BLOCK_SEPARATOR}We recieve mail.`,
		);
		expect(
			suggestions.map((suggestion) => [
				suggestion.blockId,
				suggestion.originalText,
			]),
		).toEqual([
			[firstBlockId, "Ths"],
			[secondBlockId, "recieve"],
		]);
		for (const suggestion of suggestions) {
			const blockText = editor
				.getBlock(suggestion.blockId)!
				.textContent({ resolved: true });
			expect(blockText.slice(suggestion.from, suggestion.to)).toBe(
				suggestion.originalText,
			);
		}

		editor.destroy();
	});

	it("does not lose a paragraph when another one is edited during the request", async () => {
		const pendingAnalyses: Array<() => void> = [];
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				aiSuggestionsExtension({
					debounceMs: 0,
					minStableMs: 0,
					minChangedChars: 1,
					cooldownMs: 0,
					scopeUnit: "document",
					analyzer: {
						async analyze({ scope }) {
							await new Promise<void>((resolve) => {
								pendingAnalyses.push(resolve);
							});
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
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: firstBlockId,
					from: 0,
					to: 0,
					insert: "Ths sentence works.",
				},
			],
			{ origin: "user" },
		);
		await flushTimers();
		expect(getAISuggestionsController(editor)!.getState().status).toBe(
			"requesting",
		);

		// the second paragraph lands while the first request is still in flight
		const secondBlockId = insertParagraphAfter(
			editor,
			firstBlockId,
			"We recieve mail.",
		);
		await flushTimers();
		while (pendingAnalyses.length > 0) {
			pendingAnalyses.shift()?.();
			await flushTimers();
		}

		const blockIds = getAISuggestionsController(editor)!
			.getState()
			.suggestions.map((suggestion) => suggestion.blockId)
			.sort();
		expect(blockIds).toEqual([firstBlockId, secondBlockId].sort());

		editor.destroy();
	});

	it("lets the host veto blocks beyond their type", async () => {
		const editor = createDocumentEditor({
			blockPolicy: {
				isBlockAllowed: (block: BlockHandle) =>
					!block.textContent().startsWith("We"),
			},
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: firstBlockId,
					from: 0,
					to: 0,
					insert: "Ths sentence works.",
				},
			],
			{ origin: "user" },
		);
		insertParagraphAfter(editor, firstBlockId, "We recieve mail.");
		await flushTimers();

		expect(
			getAISuggestionsController(editor)!
				.getState()
				.suggestions.map((suggestion) => suggestion.originalText),
		).toEqual(["Ths"]);

		editor.destroy();
	});
});
