import type { Editor } from "@input/pen-types";
import { buildAIReviewPresentationDecorations } from "../review/reviewPresentation";
import type { AISession } from "../types";

export function readVirtualText(
	decorations: ReadonlyArray<
		ReturnType<typeof buildAIReviewPresentationDecorations>[number]
	>,
): string {
	return decorations
		.map((decoration) =>
			decoration.type === "inline"
				? ((decoration as typeof decoration & { virtualText?: string })
						.virtualText ?? "")
				: "",
		)
		.join("");
}

export function readDecorationAttributes(
	decoration:
		| ReturnType<typeof buildAIReviewPresentationDecorations>[number]
		| undefined,
): Record<string, unknown> | undefined {
	return decoration && "attributes" in decoration
		? (decoration.attributes as Record<string, unknown>)
		: undefined;
}

export function createReviewEditor({
	blockId,
	deltas,
	text,
}: {
	blockId: string;
	deltas: Array<{ insert: string; attributes?: Record<string, unknown> }>;
	text: string;
}): Editor {
	return createReviewEditorFromBlocks([{ id: blockId, text, deltas }]);
}

export function createReviewEditorFromBlocks(
	blocks: Array<{
		id: string;
		deltas: Array<{ insert: string; attributes?: Record<string, unknown> }>;
		text: string;
	}>,
): Editor {
	const editorBlocks = blocks.map((block) => ({
		id: block.id,
		meta: () => null,
		textContent: () => block.text,
		length: () => block.text.length,
		inlineDeltas: () => [{ insert: block.text }],
	}));
	return {
		documentState: {
			allBlocks: () => editorBlocks,
		},
		getBlock: (id: string) =>
			editorBlocks.find((block) => block.id === id) ?? null,
		internals: {
			getBlockText: (id: string) => {
				const block = blocks.find((candidate) => candidate.id === id);
				return block
					? {
							toDelta: () => block.deltas,
						}
					: null;
			},
		},
	} as unknown as Editor;
}

export const MACBOOK_REPLACEMENT_ORIGINAL_TEXT = [
	"Hey Oleksandr,",
	"",
	"Sure thing— I'll have a MacBook ready for you, but feel free to bring your own setup if you prefer. See you a bit earlier, and let me know if you need anything else before then.",
	"",
	"- Krijn",
].join("\n");

export const MACBOOK_REPLACEMENT_PARAGRAPH_TEXT =
	"Sure thing— I'll have a MacBook ready for you, but feel free to bring your own setup if you prefer.";

export function buildMacBookProStreamingPreviewText(
	originalText: string,
): string {
	return originalText
		.replace("MacBook ready", "MacBook Pro ready")
		.slice(0, originalText.indexOf("ready") + "Pro ready".length);
}

export const MACBOOK_THREE_BLOCK_PARTS = {
	firstBlockText: "Hey Oleksandr,",
	secondBlockText:
		"Sure thing— I'll have a MacBook ready for you, but feel free to bring your own setup if you prefer.",
	thirdBlockText: "- Krijn",
} as const;

export function createMacBookThreeBlockReviewEditor(): Editor {
	const { firstBlockText, secondBlockText, thirdBlockText } =
		MACBOOK_THREE_BLOCK_PARTS;
	return createReviewEditorFromBlocks([
		{
			id: "body-1",
			text: firstBlockText,
			deltas: [{ insert: firstBlockText }],
		},
		{
			id: "body-2",
			text: secondBlockText,
			deltas: [{ insert: secondBlockText }],
		},
		{
			id: "body-3",
			text: thirdBlockText,
			deltas: [{ insert: thirdBlockText }],
		},
	]);
}

export function createAlphaBetaGammaReviewEditor(): Editor {
	return createReviewEditorFromBlocks([
		{
			id: "body-1",
			text: "Alpha",
			deltas: [{ insert: "Alpha" }],
		},
		{
			id: "body-2",
			text: "Beta",
			deltas: [{ insert: "Beta" }],
		},
		{
			id: "body-3",
			text: "Gamma",
			deltas: [{ insert: "Gamma" }],
		},
	]);
}

export function createHelloExclamationSuggestionEditor(): Editor {
	return createReviewEditor({
		blockId: "body-1",
		text: "Hello!",
		deltas: [
			{ insert: "Hello" },
			{
				insert: "!",
				attributes: {
					suggestion: {
						id: "suggestion-insert-1",
						action: "insert",
						author: "assistant",
						authorType: "ai",
					},
				},
			},
		],
	});
}

export const HI_TEXT_RANGE_STREAMING_PREVIEW = {
	sessionId: "session-1",
	target: {
		kind: "text-range" as const,
		blockId: "body-1",
		from: 0,
		to: 5,
	},
	text: "Hi",
	previousTextLength: 0,
};

export function createAlphaBetaFriendReviewEditor(): Editor {
	return createReviewEditorFromBlocks([
		{
			id: "body-1",
			text: "Alpha friend",
			deltas: [{ insert: "Alpha friend" }],
		},
		{
			id: "body-2",
			text: "Beta friend",
			deltas: [{ insert: "Beta friend" }],
		},
	]);
}

export function createInlineSession({
	focusOffset = 15,
	pendingSuggestionIds = ["suggestion-insert-1"],
}: {
	focusOffset?: number;
	pendingSuggestionIds?: string[];
} = {}): AISession {
	return {
		id: "session-1",
		surface: "inline-edit",
		status: "idle",
		target: {
			kind: "selection",
			selection: {
				anchor: { blockId: "body-1", offset: 0 },
				focus: { blockId: "body-1", offset: focusOffset },
				blockRange: ["body-1"],
				isMultiBlock: false,
			},
		},
		contextualPrompt: {
			anchor: {
				kind: "text-range",
				focusBlockId: "body-1",
				status: "valid",
				lastResolvedRect: null,
				selectionSnapshot: {
					anchor: { blockId: "body-1", offset: 0 },
					focus: { blockId: "body-1", offset: focusOffset },
					blockRange: ["body-1"],
					isMultiBlock: false,
				},
			},
			composer: {
				draftPrompt: "",
				isOpen: true,
				isSubmitting: false,
				canSubmitFollowUp: true,
			},
		},
		turns: [],
		promptHistory: [],
		generationIds: [],
		pendingSuggestionIds,
		createdAt: 0,
		updatedAt: 0,
		metrics: {
			streamEventCount: 0,
			commit: {
				attemptCount: 0,
				selectionReplacementCount: 0,
				scopedReplacementCount: 0,
				plainMarkdownCount: 0,
				failedCount: 0,
			},
		},
	} as unknown as AISession;
}
