import { getSelectionBlockRange } from "@input/pen-core";
import type { Editor, SelectionRecordState } from "@input/pen-types";
import { BLOCK_SURFACE_MODE_THRESHOLD } from "../constants/selection";
import type { Point } from "../geometry/types";
import {
	blockInlineFacts,
	isAtomAdjacentOffset,
	isTextCapableBlock,
	type BlockInlineFacts,
} from "./caretPredicates";
import type {
	OverlayContributor,
	OverlayFieldState,
	OverlayReadContext,
	OverlayRequest,
} from "./types";

/** The built-in local-selection contributor's id. */
const SELECTION_OVERLAY_CONTRIBUTOR_ID = "selection";

/**
 * O3: up to this many selected blocks get one outline each; above it, one
 * span per contiguous run. Matches `shouldUseBlockSelection` on purpose, so
 * below it every block is outlined and above it a run costs two reads.
 */
const OVERLAY_BLOCK_OUTLINE_LIMIT = BLOCK_SURFACE_MODE_THRESHOLD;

/** The key of the local caret request; its element identity adds the blink epoch. */
const LOCAL_CARET_KEY = "local-caret";

const NO_REQUESTS: readonly OverlayRequest[] = [];

type TextState = Extract<NonNullable<SelectionRecordState>, { type: "text" }>;
type BlockState = Extract<NonNullable<SelectionRecordState>, { type: "block" }>;

/**
 * O preamble, O5: the local caret needs an editing, focused field that is
 * not composing (IME always sees the native caret), not read-only, and not
 * editing a table cell (the cell keeps its native caret).
 */
function localCaretAllowed(field: OverlayFieldState): boolean {
	return (
		field.isEditing &&
		field.isFocused &&
		!field.isComposing &&
		!field.readonly &&
		!field.editingCell
	);
}

/** O4, O5: endpoint carets need focus and are never drawn read-only or while composing. */
function endpointCaretAllowed(field: OverlayFieldState): boolean {
	return field.isFocused && !field.isComposing && !field.readonly;
}

function samePoint(a: Point, b: Point): boolean {
	return a.blockId === b.blockId && a.offset === b.offset;
}

/**
 * The built-in local-selection contributor (§3.5). Pure with respect to the
 * DOM: it reads the selection record, the field state and the document, and
 * returns logical requests; it never measures (OV1).
 *
 * - Collapsed text: a local caret beside an atom (O1) or in an empty text
 *   block (O2); in `customCaret` mode (`caretMode: "all"`) every allowed one.
 * - Multi-block text: endpoint carets at endpoints meeting O1 or O2 (O4); in
 *   the S2-exception state (`field.substitute`), both endpoints, the partial
 *   span in each endpoint block and one span over the covered blocks (D5).
 * - Block selection: an outline per block, or a span per contiguous run
 *   above fifty blocks (O3). Grid cells: one outline around anchor..head
 *   while no cell is edited. App selections are not outlined (D13).
 *
 * Inline facts are cached per block revision, and the D5 block range and the
 * O3 runs once per record version, so an unchanged flush recomputes nothing.
 */
export function createSelectionOverlayContributor(): OverlayContributor {
	const facts = new Map<
		string,
		{
			readonly revision: number;
			readonly facts: BlockInlineFacts;
			readonly textCapable: boolean;
		}
	>();
	let rangeCache: {
		readonly version: number;
		readonly requests: readonly OverlayRequest[];
	} | null = null;

	/** Inline facts per block, re-read only when the block's revision moved. */
	function factsFor(
		editor: Editor,
		blockId: string,
	): { readonly facts: BlockInlineFacts; readonly textCapable: boolean } | null {
		const revision = editor.getBlockRevision(blockId);
		const cached = facts.get(blockId);
		if (cached && cached.revision === revision) {
			return cached;
		}
		const block = editor.getBlock(blockId);
		if (!block) {
			facts.delete(blockId);
			return null;
		}
		const entry = {
			revision,
			facts: blockInlineFacts(block),
			textCapable: isTextCapableBlock(editor, block),
		};
		facts.set(blockId, entry);
		return entry;
	}

	/** O1 or O2 at `point`. */
	function caretRuleHolds(editor: Editor, point: Point): boolean {
		const entry = factsFor(editor, point.blockId);
		if (!entry) {
			return false;
		}
		return (
			isAtomAdjacentOffset(entry.facts, point.offset) ||
			(entry.facts.length === 0 && entry.textCapable)
		);
	}

	function collapsedRequests(
		context: OverlayReadContext,
		state: TextState,
	): readonly OverlayRequest[] {
		if (!localCaretAllowed(context.field)) {
			return NO_REQUESTS;
		}
		if (
			context.caretMode !== "all" &&
			!caretRuleHolds(context.editor, state.focus)
		) {
			return NO_REQUESTS;
		}
		return [
			{
				kind: "caret",
				key: LOCAL_CARET_KEY,
				role: "local",
				point: state.focus,
				// G3: the record's affinity, never a literal (W35.R4).
				affinity: state.affinity,
			},
		];
	}

	function endpointRequest(
		state: TextState,
		endpoint: "anchor" | "focus",
	): OverlayRequest {
		return {
			kind: "caret",
			key: `endpoint:${endpoint}`,
			role: "endpoint",
			endpoint,
			point: endpoint === "anchor" ? state.anchor : state.focus,
			affinity: state.affinity,
		};
	}

	function multiBlockRequests(
		context: OverlayReadContext,
		state: TextState,
	): readonly OverlayRequest[] {
		const endpointsAllowed = endpointCaretAllowed(context.field);
		if (context.field.substitute === null) {
			if (!endpointsAllowed) {
				return NO_REQUESTS;
			}
			const requests: OverlayRequest[] = [];
			if (caretRuleHolds(context.editor, state.anchor)) {
				requests.push(endpointRequest(state, "anchor"));
			}
			if (caretRuleHolds(context.editor, state.focus)) {
				requests.push(endpointRequest(state, "focus"));
			}
			return requests;
		}
		const requests: OverlayRequest[] = endpointsAllowed
			? [endpointRequest(state, "anchor"), endpointRequest(state, "focus")]
			: [];
		requests.push(...substituteRangeRequests(context, state));
		return requests;
	}

	/** D5: the partial span in each endpoint block and one span over the blocks between. */
	function substituteRangeRequests(
		context: OverlayReadContext,
		state: TextState,
	): readonly OverlayRequest[] {
		const version = context.selection.version;
		if (rangeCache?.version === version) {
			return rangeCache.requests;
		}
		const ids = getSelectionBlockRange(context.editor.documentState, {
			type: "text",
			anchor: state.anchor,
			focus: state.focus,
		});
		const anchorFirst = ids[0] === state.anchor.blockId;
		const first = anchorFirst ? state.anchor : state.focus;
		const last = anchorFirst ? state.focus : state.anchor;
		const requests: OverlayRequest[] = [];
		const firstLength =
			factsFor(context.editor, first.blockId)?.facts.length ?? 0;
		if (first.offset < firstLength) {
			requests.push({
				kind: "range",
				key: "range:first",
				anchor: first,
				focus: { blockId: first.blockId, offset: firstLength },
			});
		}
		if (last.offset > 0) {
			requests.push({
				kind: "range",
				key: "range:last",
				anchor: { blockId: last.blockId, offset: 0 },
				focus: last,
			});
		}
		if (ids.length > 2) {
			requests.push({
				kind: "block-span",
				key: "range:covered",
				fromBlockId: ids[1]!,
				toBlockId: ids[ids.length - 2]!,
			});
		}
		rangeCache = { version, requests };
		return requests;
	}

	/** O3: an outline per block up to the limit, a span per contiguous run above it. */
	function blockRequests(
		context: OverlayReadContext,
		state: BlockState,
	): readonly OverlayRequest[] {
		if (state.blockIds.length <= OVERLAY_BLOCK_OUTLINE_LIMIT) {
			return state.blockIds.map((blockId) => ({
				kind: "block-outline",
				key: `block-outline:${blockId}`,
				blockId,
			}));
		}
		const version = context.selection.version;
		if (rangeCache?.version === version) {
			return rangeCache.requests;
		}
		const requests = contiguousRuns(context.editor, state.blockIds).map(
			(run) =>
				({
					kind: "block-span",
					key: `block-span:${run.from}`,
					fromBlockId: run.from,
					toBlockId: run.to,
				}) satisfies OverlayRequest,
		);
		rangeCache = { version, requests };
		return requests;
	}

	return {
		id: SELECTION_OVERLAY_CONTRIBUTOR_ID,
		requests(context: OverlayReadContext): readonly OverlayRequest[] {
			const state = context.selection.state;
			if (state === null) {
				return NO_REQUESTS;
			}
			switch (state.type) {
				case "text":
					if (state.anchor.blockId !== state.focus.blockId) {
						return multiBlockRequests(context, state);
					}
					return samePoint(state.anchor, state.focus)
						? collapsedRequests(context, state)
						: NO_REQUESTS;
				case "block":
					return blockRequests(context, state);
				case "cell":
					if (context.field.editingCell) {
						return NO_REQUESTS;
					}
					return [
						{
							kind: "cell-range",
							key: "cell-range",
							blockId: state.blockId,
							anchor: state.anchor,
							head: state.head,
						},
					];
				case "app":
					return NO_REQUESTS;
				default: {
					const _exhaustive: never = state;
					return _exhaustive;
				}
			}
		},
	};
}

/**
 * Maximal runs of document-order-contiguous blocks, in one pass over the
 * selected ids sorted by preorder index (no `indexOf` per id).
 */
function contiguousRuns(
	editor: Editor,
	blockIds: readonly string[],
): { readonly from: string; readonly to: string }[] {
	const indexed = blockIds
		.map((blockId) => ({
			blockId,
			index: editor.documentState.preorderIndexOf(blockId),
		}))
		.filter((entry) => entry.index >= 0)
		.sort((left, right) => left.index - right.index);
	const runs: { from: string; to: string }[] = [];
	let previous = -2;
	for (const entry of indexed) {
		const run = runs[runs.length - 1];
		if (run && entry.index === previous + 1) {
			run.to = entry.blockId;
		} else {
			runs.push({ from: entry.blockId, to: entry.blockId });
		}
		previous = entry.index;
	}
	return runs;
}
