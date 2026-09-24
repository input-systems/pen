import {
	deriveContentMoves,
	repairAnchor,
	type ContentMove,
} from "@input/pen-core";
import type {
	Anchor,
	CommitEvent,
	DocumentRange,
	Editor,
} from "@input/pen-types";
import type { AIContentFormat, AIMutationMode } from "../runtime/contracts";
import type { GenerationTarget } from "../helpers";
import type { AISurface } from "../types";
import type { AIControllerImpl } from "./aiController";
import type { GenerationExecutionState } from "./generationExecutionState";
import {
	editDocumentReviewPreviewInput,
	markdownReviewPreviewInput,
	selectionReviewPreviewInput,
} from "./streamingPreviewInput";

/**
 * Where a generation's arriving text goes, and what close does with it.
 * Resolved once; delta application and finalize both switch on `kind`.
 *
 * - `direct-write` / `suggestion-splice`: already in the document.
 * - `review-preview`: paint while streaming, then commit (or clear) on close.
 * - `buffered-commit`: hold text, commit on close, no preview.
 * - `none`: text is talk (tool channel) or otherwise must not become a mutation.
 */
export type GenerationStreamingSink =
	| { kind: "direct-write" }
	| {
			kind: "suggestion-splice";
			blockId: string;
			firstFrom: number;
			firstTo: number;
	  }
	| {
			kind: "review-preview";
			format: "markdown";
			source: "markdown-block";
			blockId: string;
			offset: number;
			replaceTargetBlock: boolean;
			replaceBlockIds?: readonly string[];
	  }
	| {
			kind: "review-preview";
			format: "plain" | "markdown";
			source: "selection";
			range: Pick<DocumentRange, "start" | "end">;
	  }
	| { kind: "buffered-commit" }
	| { kind: "none" };

export function resolveGenerationStreamingSink(input: {
	target: GenerationTarget;
	shouldStreamDirectly: boolean;
	contentFormat: AIContentFormat;
	mutationMode: AIMutationMode;
	editsArriveAsToolCalls: boolean;
	surface: AISurface | undefined;
	selectionRange: Pick<DocumentRange, "start" | "end"> | null;
	replaceTargetBlock?: boolean;
	replaceBlockIds?: readonly string[];
}): GenerationStreamingSink {
	if (input.editsArriveAsToolCalls) {
		return { kind: "none" };
	}

	if (input.target.type === "block" && input.shouldStreamDirectly) {
		return { kind: "direct-write" };
	}

	const suggestedText =
		input.mutationMode === "streaming-suggestions" &&
		input.contentFormat === "text";
	if (
		suggestedText &&
		input.target.type === "selection" &&
		input.selectionRange &&
		input.selectionRange.start.blockId === input.selectionRange.end.blockId
	) {
		return {
			kind: "suggestion-splice",
			blockId: input.selectionRange.start.blockId,
			firstFrom: input.selectionRange.start.offset,
			firstTo: input.selectionRange.end.offset,
		};
	}
	if (suggestedText && input.target.type === "block") {
		return {
			kind: "suggestion-splice",
			blockId: input.target.blockId,
			firstFrom: input.target.offset,
			firstTo: input.target.offset,
		};
	}
	if (
		input.mutationMode === "streaming-suggestions" &&
		input.contentFormat === "markdown" &&
		input.target.type === "block" &&
		input.surface === "bottom-chat"
	) {
		return {
			kind: "review-preview",
			format: "markdown",
			source: "markdown-block",
			blockId: input.target.blockId,
			offset: input.target.offset,
			replaceTargetBlock: input.replaceTargetBlock === true,
			replaceBlockIds: input.replaceBlockIds,
		};
	}
	if (input.target.type === "selection" && input.selectionRange) {
		return {
			kind: "review-preview",
			format: input.contentFormat === "markdown" ? "markdown" : "plain",
			source: "selection",
			range: input.selectionRange,
		};
	}
	if (input.target.type === "block") {
		return { kind: "buffered-commit" };
	}
	return { kind: "none" };
}

export function applyGenerationStreamingDelta(
	controller: AIControllerImpl,
	state: GenerationExecutionState,
	nextDelta: string,
): void {
	const sink = state.streamingSink;
	switch (sink.kind) {
		case "direct-write":
			if (state.target.type === "block") {
				state.streamingTarget?.appendDelta(nextDelta);
			}
			return;
		case "suggestion-splice":
			applySuggestionSplice(controller, state, nextDelta);
			return;
		case "review-preview":
			applyReviewPreviewDelta(controller, state, sink);
			return;
		case "buffered-commit":
		case "none":
			return;
		default: {
			const exhaustive: never = sink;
			return exhaustive;
		}
	}
}

/**
 * ST2: the durable position of a streaming suggestion rewrite. The write head
 * is an anchor rather than an offset plus a running length, so a collaborator
 * editing the same block while the model streams moves it instead of leaving
 * every later delta spliced into the wrong place.
 */
export interface SuggestionSpliceHead {
	/**
	 * Start of the range the first delta marks deleted, cleared once that delta
	 * has had its chance. Null when the rewrite starts collapsed.
	 */
	deleteFrom: Anchor | null;
	/** Where the next delta inserts. Suggest mode inserts at the range end. */
	writeHead: Anchor;
	/** User marks shared by the text being rewritten. */
	marks?: Record<string, unknown>;
	/** Stop repairing. The generation is over. */
	release(): void;
}

export function createSuggestionSpliceHead(
	editor: Editor,
	sink: GenerationStreamingSink,
	marks?: Record<string, unknown>,
): SuggestionSpliceHead | null {
	if (sink.kind !== "suggestion-splice") {
		return null;
	}
	// assoc 1 so each delta we insert leaves the head after it (AN2); the
	// delete start takes assoc -1 so it stays outside the arriving text.
	const writeHead = editor.anchors.create(
		{ blockId: sink.blockId, offset: sink.firstTo },
		1,
	);
	if (!writeHead) {
		return null;
	}
	const deleteFrom =
		sink.firstTo > sink.firstFrom
			? editor.anchors.create(
					{ blockId: sink.blockId, offset: sink.firstFrom },
					-1,
				)
			: null;

	let lastCommitId = Number.NaN;
	const head: SuggestionSpliceHead = {
		deleteFrom,
		writeHead,
		...(marks ? { marks } : {}),
		release: editor.on("commit", (event: CommitEvent) => {
			if (event.summary.commitId === lastCommitId) {
				return;
			}
			lastCommitId = event.summary.commitId;
			// AN14: a split or merge under the rewrite moves the head into
			// another block, and repair is what carries it across. Resolving
			// alone would leave the next delta wherever the old offset landed.
			const moves = deriveContentMoves(event.summary, undefined);
			head.writeHead = repairThroughMoves(editor, head.writeHead, moves);
			if (head.deleteFrom) {
				head.deleteFrom = repairThroughMoves(
					editor,
					head.deleteFrom,
					moves,
				);
			}
		}),
	};
	return head;
}

function repairThroughMoves(
	editor: Editor,
	anchor: Anchor,
	moves: readonly ContentMove[],
): Anchor {
	const repaired = repairAnchor(editor, anchor, moves);
	// repair reads the position the anchor last resolved at, and only a
	// resolve refreshes that. Skip it and the next split is measured against
	// wherever the head sat several deltas ago.
	editor.anchors.resolve(repaired);
	return repaired;
}

function applySuggestionSplice(
	controller: AIControllerImpl,
	state: GenerationExecutionState,
	nextDelta: string,
): void {
	const head = state.suggestionSpliceHead;
	if (!head) {
		return;
	}
	const editor = controller._editor;
	const to = editor.anchors.resolve(head.writeHead);
	if (!to) {
		// AN1: a null resolve is a store miss as readily as a dead block. A
		// store miss retries on the next delta; a removed block ends the sink,
		// which is also what keeps this from reporting once per delta.
		if (!editor.getBlock(head.writeHead.blockId)) {
			head.release();
			state.suggestionSpliceHead = null;
			reportSpliceDegraded(
				controller,
				"The block being rewritten was removed; dropped the streamed text.",
			);
		}
		return;
	}
	const deleteFrom = head.deleteFrom
		? editor.anchors.resolve(head.deleteFrom)
		: null;
	// the delete gets exactly this one delta: once text is inserted at the
	// head, a later attempt would span the arriving text too and mark it
	// deleted along with the original.
	const hadDelete = head.deleteFrom != null;
	head.deleteFrom = null;
	const deletes = deleteFrom != null && deleteFrom.blockId === to.blockId;
	if (hadDelete && !deletes) {
		reportSpliceDegraded(
			controller,
			"The text being rewritten moved to another block; kept it and appended the rewrite.",
		);
	}
	const from = deletes ? Math.min(deleteFrom.offset, to.offset) : to.offset;
	controller._applySuggestedAIOps(
		[
			{
				type: "splice-text",
				blockId: to.blockId,
				from,
				to: to.offset,
				insert: nextDelta,
				...(head.marks ? { marks: head.marks } : {}),
			},
		],
		state.context?.sessionId,
		{ undoGroupId: state.seedGeneration.undoGroupId },
	);
}

/**
 * RS3: a rewrite that lands something other than what it proposed is reported
 * rather than left for the user to spot.
 */
function reportSpliceDegraded(
	controller: AIControllerImpl,
	message: string,
): void {
	controller._editor.internals.emit("diagnostic", {
		level: "warn",
		source: "ai",
		code: "AI_SUGGESTION_SPLICE_DEGRADED",
		message,
	});
}

function applyReviewPreviewDelta(
	controller: AIControllerImpl,
	state: GenerationExecutionState,
	sink: Extract<GenerationStreamingSink, { kind: "review-preview" }>,
): void {
	const active = controller._state.activeGeneration;
	if (!active) {
		return;
	}
	const sessionId = active.sessionId ?? active.id;
	if (sink.source === "markdown-block") {
		controller.setStreamingReviewPreview(
			markdownReviewPreviewInput(controller._editor, {
				sessionId,
				turnId: active.turnId,
				blockId: sink.blockId,
				offset: sink.offset,
				replaceTargetBlock: sink.replaceTargetBlock,
				replaceBlockIds: sink.replaceBlockIds,
				text: state.currentText,
			}),
		);
		return;
	}
	const preview = selectionReviewPreviewInput(controller._editor, {
		sessionId,
		turnId: active.turnId,
		range: sink.range,
		text: state.currentText,
		format: sink.format,
	});
	if (preview) {
		controller.setStreamingReviewPreview(preview);
	}
}

export function applyEditDocumentPreview(
	controller: AIControllerImpl,
	preview: {
		operationIndex: number;
		blockId: string;
		operation: string | null;
		text: string;
	},
	activeGeneration: NonNullable<
		AIControllerImpl["_state"]["activeGeneration"]
	>,
): void {
	controller.setStreamingReviewPreview(
		editDocumentReviewPreviewInput(controller._editor, {
			sessionId: activeGeneration.sessionId ?? activeGeneration.id,
			turnId: activeGeneration.turnId,
			operationIndex: preview.operationIndex,
			blockId: preview.blockId,
			operation: preview.operation,
			text: preview.text,
		}),
		{ activeGeneration },
	);
}
