import type { Decoration } from "@input/pen-types";
import { buildGenerationZoneDecorations } from "../decorations/generationZone";
import { buildAIReviewPresentationDecorations } from "../review/reviewPresentation";
import type { SuggestionDecorationIndex } from "../review/suggestionIndex";
import type {
	AIStreamingReviewPreview,
	AIStreamingReviewPreviewInput,
	AIStreamingReviewPreviewTarget,
} from "../types";
import { areStringArraysEqual } from "../helpers";
import type {
	AIControllerImpl,
	StreamingPreviewStatePatch,
} from "./aiController";

function buildControllerDecorations(
	host: AIControllerImpl,
	suggestions: SuggestionDecorationIndex,
): Decoration[] {
	return [
		...buildAIReviewPresentationDecorations({
			activeGeneration: host._state.activeGeneration,
			activeSessionId: host._state.activeSessionId,
			editor: host._editor,
			sessions: host._state.sessions,
			suggestionPresentation: host._suggestionPresentation,
			streamingReviewPreviews: host._state.streamingReviewPreviews,
			suggestions,
		}),
		...buildGenerationZoneDecorations(host._state.activeGeneration),
	];
}

export const decorationControllerMethods = {
	// `extra` lands in the same `_setState` as the preview so a token does
	// not rebuild decorations twice (generation row + preview row).
	setStreamingReviewPreview(
		this: AIControllerImpl,
		input: AIStreamingReviewPreviewInput,
		extra?: StreamingPreviewStatePatch,
	): void {
		this._queuedStreamingPreview = {
			inputs: upsertPreviewByOperation(
				this._queuedStreamingPreview?.inputs ?? [],
				input,
			),
			extra,
		};
		scheduleStreamingPreviewFlush(this);
	},

	clearStreamingReviewPreview(
		this: AIControllerImpl,
		sessionId?: string,
		extra?: StreamingPreviewStatePatch,
	): void {
		cancelStreamingPreviewFlush(this);
		applyClearStreamingReviewPreview(this, sessionId, extra);
	},

	/**
	 * Everything but suggestion decorations, which the scoped review source
	 * owns: selection context, streaming previews and the generation zone.
	 * Cost follows the active session, previews and generation (SCALE2).
	 */
	buildPresentationDecorations(
		this: AIControllerImpl,
		suggestions: SuggestionDecorationIndex,
	): Decoration[] {
		return buildControllerDecorations(this, suggestions);
	},
};

function scheduleStreamingPreviewFlush(host: AIControllerImpl): void {
	// Node tests have no rAF: apply now so probes that read state between
	// deltas still see every fragment. The browser batches a TCP burst to
	// one paint so a chunk of fragments does not run a full reconcile each.
	if (typeof requestAnimationFrame !== "function") {
		flushQueuedStreamingPreview(host);
		return;
	}
	if (host._streamingPreviewRaf != null) {
		return;
	}
	host._streamingPreviewRaf = requestAnimationFrame(() => {
		host._streamingPreviewRaf = null;
		flushQueuedStreamingPreview(host);
	});
}

function cancelStreamingPreviewFlush(host: AIControllerImpl): void {
	if (host._streamingPreviewRaf != null) {
		cancelAnimationFrame(host._streamingPreviewRaf);
		host._streamingPreviewRaf = null;
	}
	host._queuedStreamingPreview = null;
}

function flushQueuedStreamingPreview(host: AIControllerImpl): void {
	const queued = host._queuedStreamingPreview;
	if (!queued) {
		return;
	}
	host._queuedStreamingPreview = null;
	applyStreamingReviewPreviews(host, queued.inputs, queued.extra);
}

function applyStreamingReviewPreviews(
	host: AIControllerImpl,
	inputs: readonly AIStreamingReviewPreviewInput[],
	extra?: StreamingPreviewStatePatch,
): void {
	let previews = host._state.streamingReviewPreviews;
	let changed = false;
	for (const input of inputs) {
		const next = mergeStreamingReviewPreview(previews, input);
		if (next !== previews) {
			previews = next;
			changed = true;
		}
	}
	if (!changed) {
		if (extra) {
			host._setState(extra);
		}
		return;
	}
	host._setState({ ...extra, streamingReviewPreviews: previews });
}

/**
 * The list with this operation's preview brought up to date.
 *
 * Returns the list unchanged when the text has not moved, so a fragment that
 * only grows another operation does not rebuild every decoration. A preview
 * from a different turn replaces the list rather than joining it: two turns are
 * never on screen at once.
 */
function mergeStreamingReviewPreview(
	previews: readonly AIStreamingReviewPreview[],
	input: AIStreamingReviewPreviewInput,
): readonly AIStreamingReviewPreview[] {
	const text = input.text ?? "";
	const operationIndex = previewOperation(input);
	const ownsTurn = previews.every(
		(preview) =>
			preview.sessionId === input.sessionId &&
			preview.turnId === input.turnId,
	);
	// An operation with nothing in it yet withdraws its own preview and only
	// its own: the operations beside it in the same call are still proposing
	// text that has not been written. A delete never has text; its blocks are
	// the proposal.
	if (text.length === 0 && input.deletesBlocks !== true) {
		return withdrawOperationPreview(previews, operationIndex, ownsTurn);
	}
	const previous = ownsTurn
		? (previews.find(
				(preview) => previewOperation(preview) === operationIndex,
			) ?? null)
		: null;
	const merged = mergeOperationPreview(previous, input, operationIndex);
	if (merged == null) {
		return previews;
	}
	if (!ownsTurn) {
		return [merged];
	}
	if (previous == null) {
		return [...previews, merged];
	}
	return previews.map((preview) =>
		previewOperation(preview) === operationIndex ? merged : preview,
	);
}

function withdrawOperationPreview(
	previews: readonly AIStreamingReviewPreview[],
	operationIndex: number,
	ownsTurn: boolean,
): readonly AIStreamingReviewPreview[] {
	const remaining = ownsTurn
		? previews.filter(
				(preview) => previewOperation(preview) !== operationIndex,
			)
		: [];
	return remaining.length === previews.length ? previews : remaining;
}

/** The operation's next preview, or `null` when nothing on screen would change. */
function mergeOperationPreview(
	previous: AIStreamingReviewPreview | null,
	input: AIStreamingReviewPreviewInput,
	operationIndex: number,
): AIStreamingReviewPreview | null {
	const text = input.text ?? "";
	const isSamePreview =
		previous != null &&
		areStreamingReviewPreviewTargetsEqual(previous.target, input.target);
	if (
		isSamePreview &&
		previous.text === text &&
		previous.complete === input.complete &&
		previous.deletesBlocks === input.deletesBlocks &&
		previous.replacesBlocks === input.replacesBlocks
	) {
		return null;
	}
	return {
		sessionId: input.sessionId,
		turnId: input.turnId,
		operationIndex,
		target: input.target,
		text,
		previousTextLength: isSamePreview ? previous.text.length : 0,
		complete: input.complete,
		deletesBlocks: input.deletesBlocks,
		replacesBlocks: input.replacesBlocks,
	};
}

/** A preview with no stated operation is the call's first and only one. */
function previewOperation(
	preview: Pick<AIStreamingReviewPreviewInput, "operationIndex">,
): number {
	return preview.operationIndex ?? 0;
}

function applyClearStreamingReviewPreview(
	host: AIControllerImpl,
	sessionId?: string,
	extra?: StreamingPreviewStatePatch,
): void {
	const previews = host._state.streamingReviewPreviews;
	const remaining =
		sessionId == null
			? []
			: previews.filter((preview) => preview.sessionId !== sessionId);
	if (remaining.length === previews.length) {
		if (extra) {
			host._setState(extra);
		}
		return;
	}
	host._setState({ ...extra, streamingReviewPreviews: remaining });
}

function upsertPreviewByOperation(
	inputs: readonly AIStreamingReviewPreviewInput[],
	input: AIStreamingReviewPreviewInput,
): readonly AIStreamingReviewPreviewInput[] {
	const operationIndex = previewOperation(input);
	const existing = inputs.findIndex(
		(queued) => previewOperation(queued) === operationIndex,
	);
	if (existing < 0) {
		return [...inputs, input];
	}
	return inputs.map((queued, index) => (index === existing ? input : queued));
}

function areStreamingReviewPreviewTargetsEqual(
	left: AIStreamingReviewPreviewTarget,
	right: AIStreamingReviewPreviewTarget,
): boolean {
	if (left.kind !== right.kind) {
		return false;
	}

	switch (left.kind) {
		case "text-range":
			return (
				right.kind === "text-range" &&
				left.blockId === right.blockId &&
				left.from === right.from &&
				left.to === right.to
			);
		case "block-range":
			return (
				right.kind === "block-range" &&
				left.start.blockId === right.start.blockId &&
				left.start.offset === right.start.offset &&
				left.end.blockId === right.end.blockId &&
				left.end.offset === right.end.offset &&
				areStringArraysEqual(left.blockIds, right.blockIds)
			);
		case "insertion-point":
			return (
				right.kind === "insertion-point" &&
				left.blockId === right.blockId &&
				left.offset === right.offset
			);
		default: {
			const exhaustive: never = left;
			return exhaustive;
		}
	}
}
