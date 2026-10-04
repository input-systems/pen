import type { Decoration, Editor } from "@input/pen-types";
import type { AIExtensionConfig, AIStreamingReviewPreview } from "../types";
import { mapStreamingBlockRangeTextOffset } from "../suggestions/replacementPlan/blockRangeTextOffset";
import {
	buildStreamingPreviewPlan,
	normalizeStreamingBlockRange,
	type BlockRangeStreamingPreviewPlan,
	type StreamingPreviewPlanResult,
} from "../suggestions/replacementPlan/streamingPreviewPlan";
import {
	createStreamingDeleteBlockDecoration,
	createStreamingDeleteDecoration,
} from "./streamingPreviewDeleteDecorations";
import {
	resolveStreamingPreviewAnchor,
	virtualPreviewTextDecorations,
} from "./streamingPreviewVirtualDecorations";

type SuggestionPresentation = NonNullable<
	AIExtensionConfig["suggestionPresentation"]
>;

export function buildStreamingReviewPreviewDecorations({
	editor,
	preview,
	suggestionPresentation,
}: {
	editor: Editor;
	preview: AIStreamingReviewPreview;
	suggestionPresentation: SuggestionPresentation;
}): Decoration[] {
	if (preview.deletesBlocks === true) {
		return deletedBlockDecorations(editor, preview.target);
	}
	const decorations = previewTextDecorations({
		editor,
		preview,
		suggestionPresentation,
	});
	return preview.replacesBlocks === true
		? [
				...decorations,
				...emptyEdgeBlockDecorations(editor, preview.target, decorations),
			]
		: decorations;
}

function previewTextDecorations({
	editor,
	preview,
	suggestionPresentation,
}: {
	editor: Editor;
	preview: AIStreamingReviewPreview;
	suggestionPresentation: SuggestionPresentation;
}): Decoration[] {
	const text = preview.text;
	if (text.length === 0) {
		return [];
	}
	const anchor = resolveStreamingPreviewAnchor(preview);
	if (!anchor) {
		return [];
	}

	const replacementPlan = buildStreamingPreviewPlan(editor, preview);
	if (replacementPlan) {
		return decorationsForReplacementPlan({
			editor,
			plan: replacementPlan,
			preview,
			suggestionPresentation,
		});
	}

	return [
		...deletionDecorationsForTarget({
			editor,
			suggestionPresentation,
			target: preview.target,
		}),
		...virtualPreviewTextDecorations({
			blockId: anchor.blockId,
			offset: anchor.offset,
			preview,
			text,
		}),
	];
}

/**
 * A replace removes its edge blocks whole too, but an empty one has no text
 * to strike and would stay on screen as an empty line accept removes (RS6).
 * Hide it, unless it already carries a decoration — the replacement text is
 * shown in it, or it is hidden as a middle block.
 */
function emptyEdgeBlockDecorations(
	editor: Editor,
	target: AIStreamingReviewPreview["target"],
	decorations: readonly Decoration[],
): Decoration[] {
	if (target.kind !== "block-range") {
		return [];
	}
	const decorated = new Set(decorations.map((decoration) => decoration.blockId));
	const edges = new Set([target.start.blockId, target.end.blockId]);
	return [...edges]
		.filter(
			(blockId) =>
				!decorated.has(blockId) && editor.getBlock(blockId)?.length() === 0,
		)
		.map((blockId) => createStreamingDeleteBlockDecoration(blockId));
}

/**
 * A delete hides each block it removes whole. Striking only the text would
 * leave an empty line where accept leaves nothing (RS6).
 */
function deletedBlockDecorations(
	editor: Editor,
	target: AIStreamingReviewPreview["target"],
): Decoration[] {
	const blockIds =
		target.kind === "block-range" ? target.blockIds : [target.blockId];
	return blockIds
		.filter((blockId) => editor.getBlock(blockId) != null)
		.map((blockId) => createStreamingDeleteBlockDecoration(blockId));
}

function decorationsForReplacementPlan({
	editor,
	plan,
	preview,
	suggestionPresentation,
}: {
	editor: Editor;
	plan: StreamingPreviewPlanResult;
	preview: AIStreamingReviewPreview;
	suggestionPresentation: SuggestionPresentation;
}): Decoration[] {
	if (plan.kind === "text-range") {
		return [
			...inlineDeleteDecorations({
				blockId: plan.blockId,
				from: plan.deleteFrom,
				to: plan.deleteTo,
				suggestionPresentation,
			}),
			...virtualPreviewTextDecorations({
				blockId: plan.blockId,
				offset: plan.insertOffset,
				preview,
				text: plan.text,
			}),
		];
	}
	if (plan.kind === "aligned-block-range") {
		return plan.plans.flatMap((textPlan) =>
			decorationsForReplacementPlan({
				editor,
				plan: textPlan,
				preview,
				suggestionPresentation,
			}),
		);
	}

	return decorationsForBlockRangePlan({
		editor,
		plan,
		preview,
		suggestionPresentation,
	});
}

function decorationsForBlockRangePlan({
	editor,
	plan,
	preview,
	suggestionPresentation,
}: {
	editor: Editor;
	plan: BlockRangeStreamingPreviewPlan;
	preview: AIStreamingReviewPreview;
	suggestionPresentation: SuggestionPresentation;
}): Decoration[] {
	const insertPosition = mapStreamingBlockRangeTextOffset(
		editor,
		plan.normalizedRange,
		plan.deleteFromChar,
	);
	const deleteEndPosition = mapStreamingBlockRangeTextOffset(
		editor,
		plan.normalizedRange,
		plan.deleteToChar,
	);

	return [
		...crossBlockDeletionDecorations({
			editor,
			start: insertPosition,
			end: deleteEndPosition,
			middleBlockIds: middleBlockIdsBetween(
				plan.normalizedRange,
				insertPosition.blockId,
				deleteEndPosition.blockId,
			),
			suggestionPresentation,
		}),
		...virtualPreviewTextDecorations({
			blockId: insertPosition.blockId,
			offset: insertPosition.offset,
			preview,
			text: plan.insertText,
		}),
	];
}

function deletionDecorationsForTarget({
	editor,
	suggestionPresentation,
	target,
}: {
	editor: Editor;
	suggestionPresentation: SuggestionPresentation;
	target: AIStreamingReviewPreview["target"];
}): Decoration[] {
	switch (target.kind) {
		case "text-range":
			return inlineDeleteDecorations({
				blockId: target.blockId,
				from: Math.min(target.from, target.to),
				to: Math.max(target.from, target.to),
				suggestionPresentation,
			});
		case "block-range": {
			const normalizedRange = normalizeStreamingBlockRange(
				editor,
				target,
			);
			if (!normalizedRange) {
				return [];
			}
			if (normalizedRange.start.blockId === normalizedRange.end.blockId) {
				return inlineDeleteDecorations({
					blockId: normalizedRange.start.blockId,
					from: Math.min(
						normalizedRange.start.offset,
						normalizedRange.end.offset,
					),
					to: Math.max(
						normalizedRange.start.offset,
						normalizedRange.end.offset,
					),
					suggestionPresentation,
				});
			}
			return crossBlockDeletionDecorations({
				editor,
				start: normalizedRange.start,
				end: normalizedRange.end,
				middleBlockIds: normalizedRange.middleBlockIds,
				suggestionPresentation,
			});
		}
		case "insertion-point":
			return [];
		default: {
			const exhaustive: never = target;
			return exhaustive;
		}
	}
}

function inlineDeleteDecorations({
	blockId,
	from,
	to,
	suggestionPresentation,
}: {
	blockId: string;
	from: number;
	to: number;
	suggestionPresentation: SuggestionPresentation;
}): Decoration[] {
	if (to <= from) {
		return [];
	}
	return [
		createStreamingDeleteDecoration({
			blockId,
			from,
			suggestionPresentation,
			to,
		}),
	];
}

function crossBlockDeletionDecorations({
	editor,
	start,
	end,
	middleBlockIds,
	suggestionPresentation,
}: {
	editor: Editor;
	start: { blockId: string; offset: number };
	end: { blockId: string; offset: number };
	middleBlockIds: readonly string[];
	suggestionPresentation: SuggestionPresentation;
}): Decoration[] {
	if (start.blockId === end.blockId) {
		return inlineDeleteDecorations({
			blockId: start.blockId,
			from: Math.min(start.offset, end.offset),
			to: Math.max(start.offset, end.offset),
			suggestionPresentation,
		});
	}

	const decorations: Decoration[] = [];
	const startBlockTextLength =
		editor.getBlock(start.blockId)?.textContent().length ?? start.offset;
	if (start.offset < startBlockTextLength) {
		decorations.push(
			createStreamingDeleteDecoration({
				blockId: start.blockId,
				from: start.offset,
				suggestionPresentation,
				to: startBlockTextLength,
			}),
		);
	}
	for (const blockId of middleBlockIds) {
		decorations.push(createStreamingDeleteBlockDecoration(blockId));
	}
	if (end.offset > 0) {
		decorations.push(
			createStreamingDeleteDecoration({
				blockId: end.blockId,
				from: 0,
				suggestionPresentation,
				to: end.offset,
			}),
		);
	}
	return decorations;
}

function middleBlockIdsBetween(
	normalizedRange: BlockRangeStreamingPreviewPlan["normalizedRange"],
	startBlockId: string,
	endBlockId: string,
): string[] {
	const orderedBlockIds = [
		normalizedRange.start.blockId,
		...normalizedRange.middleBlockIds,
		normalizedRange.end.blockId,
	].filter((blockId, index, blockIds) => blockIds.indexOf(blockId) === index);
	const fromIndex = orderedBlockIds.indexOf(startBlockId);
	const toIndex = orderedBlockIds.indexOf(endBlockId);
	if (fromIndex < 0 || toIndex < 0) {
		return [];
	}
	return orderedBlockIds.slice(
		Math.min(fromIndex, toIndex) + 1,
		Math.max(fromIndex, toIndex),
	);
}
