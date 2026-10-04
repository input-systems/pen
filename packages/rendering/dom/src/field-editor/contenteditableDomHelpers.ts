import type { Editor } from "@input/pen-types";
import { measureWithRoot } from "../geometry/rootGeometry";
import { DATA_ATTRS } from "../utils/dataAttributes";
import type { FieldEditorDelta } from "./crdt";
import { domPointToOffset } from "./selectionBridge";
import { findInlineContentElement } from "./selectionDomQueries";

const LINE_EDGE_SEAM = Symbol.for("pen.lineEdgeSeam");

type LineEdgeMeasure = (
	editor: Editor,
	current: { blockId: string; offset: number },
	edge: "start" | "end",
) => { blockId: string; offset: number } | null;

export function ensureLineEdgeMeasure(editor: Editor): void {
	const host = editor as unknown as Record<
		symbol,
		LineEdgeMeasure | undefined
	>;
	if (host[LINE_EDGE_SEAM]) {
		return;
	}
	host[LINE_EDGE_SEAM] = (_ed, current, edge) =>
		measureVisualLineEdge(current, edge);
}

export function requiresResolvedInputRange(inputType: string): boolean {
	return (
		inputType === "insertText" ||
		inputType === "insertFromDrop" ||
		inputType === "insertReplacementText" ||
		inputType === "deleteContentBackward" ||
		inputType === "deleteContentForward" ||
		inputType === "deleteWordBackward" ||
		inputType === "deleteWordForward" ||
		inputType === "deleteSoftLineBackward" ||
		inputType === "deleteHardLineBackward" ||
		inputType === "deleteSoftLineForward" ||
		inputType === "deleteHardLineForward" ||
		inputType === "insertLineBreak"
	);
}

/**
 * Whether an input has a range: the event's target range for a replacement,
 * else whatever `resolveInputRange` reports (the authority after a reader
 * sync, W3.R5).
 */
export function canResolveInputRange(
	event: InputEvent,
	element: HTMLElement,
	resolveInputRange: () => { start: number; end: number } | null,
): boolean {
	if (event.inputType === "insertReplacementText") {
		const targetRanges = event.getTargetRanges?.();
		if (targetRanges?.length) {
			return staticRangeToOffsets(targetRanges[0], element) !== null;
		}
	}

	return resolveInputRange() !== null;
}

/**
 * Convert a StaticRange (from getTargetRanges) to character offsets
 * within the inline content element.
 */
export function staticRangeToOffsets(
	staticRange: StaticRange,
	element: HTMLElement,
): { start: number; end: number } | null {
	if (
		(staticRange.startContainer !== element &&
			!element.contains(staticRange.startContainer)) ||
		(staticRange.endContainer !== element &&
			!element.contains(staticRange.endContainer))
	) {
		return null;
	}

	const startOffset = domPointToOffset(
		element,
		staticRange.startContainer,
		staticRange.startOffset,
	);
	const endOffset = domPointToOffset(
		element,
		staticRange.endContainer,
		staticRange.endOffset,
	);

	return {
		start: Math.min(startOffset, endOffset),
		end: Math.max(startOffset, endOffset),
	};
}

type TextDiffRebaseOp =
	| { type: "insert"; offset: number; text: string }
	| { type: "delete"; offset: number; length: number };

/**
 * C2 (D3): rebases a composition diff taken against the composition-start
 * text over the collaborator deltas deferred while it ran, so the result
 * equals what two converged `Y.Doc`s produce with the remote edit ordered
 * first.
 *
 * The base text is replayed as original-character tokens through each
 * deferred delta with Yjs's placement: an insert lands after any deleted
 * characters at its index, and within one delta the deletes at a cursor
 * apply before the inserts there (a replace is a delete, then an insert).
 * Offsets alone cannot say whether remote text sits before or after a
 * character it deleted, which is why this is not an offset mapping.
 *
 * - The composed text goes where a local delete-then-insert puts it in
 *   Yjs: immediately before the original character that followed the
 *   replaced range, so every remote insert at or inside the range —
 *   including one at exactly the composition start — lands before it.
 * - The delete removes only the original characters of the range that are
 *   still alive, so a remote insert inside the range survives and a remote
 *   delete shrinks it.
 *
 * The result is ordered for sequential application in one apply: the insert
 * first, then the deletes from the highest offset down, every one of which
 * ends at or before the insert.
 */
export function rebaseTextDiffOps(
	ops: TextDiffRebaseOp[],
	deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }>,
	baseLength: number,
): TextDiffRebaseOp[] {
	if (deferredRemoteDeltas.length === 0 || ops.length === 0) {
		return ops;
	}
	const deleteOp = ops.find((op) => op.type === "delete");
	const insertOp = ops.find((op) => op.type === "insert");
	const from = deleteOp?.offset ?? insertOp?.offset ?? 0;
	const to = from + (deleteOp?.type === "delete" ? deleteOp.length : 0);

	let tokens: ReplayToken[] = Array.from({ length: baseLength }, (_, index) => ({
		original: index,
		deleted: false,
	}));
	for (const { delta } of deferredRemoteDeltas) {
		tokens = replayDelta(tokens, delta);
	}

	// Live offsets: each token's position counting only live tokens before it.
	const liveBefore: number[] = [];
	let live = 0;
	let insertAt = -1;
	for (const token of tokens) {
		liveBefore.push(live);
		if (insertAt === -1 && token.original === to) insertAt = live;
		if (!token.deleted) live++;
	}
	if (insertAt === -1) insertAt = live;

	const result: TextDiffRebaseOp[] = [];
	if (insertOp?.type === "insert") {
		result.push({ type: "insert", offset: insertAt, text: insertOp.text });
	}
	// Maximal runs of the range's surviving originals, highest first.
	const runs: Array<{ start: number; end: number }> = [];
	tokens.forEach((token, index) => {
		if (token.deleted || token.original === null) return;
		if (token.original < from || token.original >= to) return;
		const offset = liveBefore[index]!;
		const last = runs[runs.length - 1];
		if (last && last.end === offset) last.end = offset + 1;
		else runs.push({ start: offset, end: offset + 1 });
	});
	for (const run of runs.reverse()) {
		result.push({ type: "delete", offset: run.start, length: run.end - run.start });
	}
	return result;
}

type ReplayToken = { readonly original: number | null; deleted: boolean };

/** Applies one delta to the token list with Yjs's placement (see `rebaseTextDiffOps`). */
function replayDelta(tokens: ReplayToken[], delta: FieldEditorDelta[]): ReplayToken[] {
	const next = [...tokens];
	let index = 0;
	const skipToLive = () => {
		while (index < next.length && next[index]!.deleted) index++;
	};
	let pendingInserts = 0;
	const flushInserts = () => {
		if (pendingInserts === 0) return;
		// An insert lands after the deleted characters at its index.
		while (index < next.length && next[index]!.deleted) index++;
		const inserted = Array.from({ length: pendingInserts }, () => ({
			original: null,
			deleted: false,
		}));
		next.splice(index, 0, ...inserted);
		index += pendingInserts;
		pendingInserts = 0;
	};
	for (const part of delta) {
		if (part.retain != null) {
			flushInserts();
			for (let remaining = part.retain; remaining > 0; remaining--) {
				skipToLive();
				index++;
			}
			continue;
		}
		if (part.delete != null) {
			// Deletes at this cursor apply before inserts queued at it.
			const at = index;
			for (let remaining = part.delete; remaining > 0; remaining--) {
				skipToLive();
				if (index < next.length) next[index]!.deleted = true;
				index++;
			}
			index = at;
			continue;
		}
		if (part.insert != null) {
			pendingInserts += typeof part.insert === "string" ? part.insert.length : 1;
		}
	}
	flushInserts();
	return next;
}

/** Where the caret sits after `rebased` applies: the end of the composed text. */
export function caretAfterRebasedDiff(rebased: readonly TextDiffRebaseOp[]): number | null {
	const insert = rebased.find((op) => op.type === "insert");
	const deletes = rebased.filter((op) => op.type === "delete");
	if (insert?.type === "insert") {
		// Every delete ends at or before the insert, so each one pulls it back.
		const removedBefore = deletes.reduce(
			(sum, op) => sum + (op.type === "delete" ? op.length : 0),
			0,
		);
		return insert.offset + insert.text.length - removedBefore;
	}
	const lowest = deletes.reduce<number | null>(
		(min, op) => (min === null || op.offset < min ? op.offset : min),
		null,
	);
	return lowest;
}

/**
 * Maps an offset recorded before deferred remote deltas onto the text after
 * them (C2). Shared by the composition diff and the composition caret.
 */
export function mapOffsetThroughRemoteDeltas(
	originalOffset: number,
	deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }>,
): number {
	return mapOffsetThroughDeltas(
		originalOffset,
		deferredRemoteDeltas,
		"downstream",
	);
}

/**
 * The upstream twin of {@link mapOffsetThroughRemoteDeltas}: a remote insert
 * at exactly `originalOffset` stays after it. C2 maps the end of a replaced
 * range this way, so a remote insert at the range's end stays outside it.
 */
export function mapOffsetThroughRemoteDeltasUpstream(
	originalOffset: number,
	deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }>,
): number {
	return mapOffsetThroughDeltas(
		originalOffset,
		deferredRemoteDeltas,
		"upstream",
	);
}

/**
 * `downstream` moves the offset past a remote insert at exactly that offset;
 * `upstream` leaves it in front.
 */
function mapOffsetThroughDeltas(
	originalOffset: number,
	deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }>,
	bias: "downstream" | "upstream",
): number {
	let mappedOffset = originalOffset;
	for (const { delta } of deferredRemoteDeltas) {
		let cursor = 0;
		for (const part of delta) {
			if (part.retain != null) {
				cursor += part.retain;
				continue;
			}
			if (part.delete != null) {
				if (cursor < mappedOffset) {
					mappedOffset -= Math.min(
						part.delete,
						mappedOffset - cursor,
					);
				}
				continue;
			}
			if (part.insert != null) {
				const insertedLength =
					typeof part.insert === "string" ? part.insert.length : 1;
				if (
					cursor < mappedOffset ||
					(bias === "downstream" && cursor === mappedOffset)
				) {
					mappedOffset += insertedLength;
				}
				cursor += insertedLength;
			}
		}
	}
	return mappedOffset;
}

export function isNavigationSelectionKey(event: KeyboardEvent): boolean {
	switch (event.key) {
		case "ArrowLeft":
		case "ArrowRight":
		case "ArrowUp":
		case "ArrowDown":
		case "Home":
		case "End":
		case "PageUp":
		case "PageDown":
			return true;
		default:
			return false;
	}
}

/**
 * Which end of the visual line box to seek. On an RTL line `"start"` is the
 * right edge, so this is a visual direction and not a logical offset order.
 */
type VisualLineEdge = "start" | "end";

/** A caret position as the line-edge measure addresses it. */
type VisualLinePoint = {
	readonly blockId: string;
	readonly offset: number;
};

/**
 * Resolves the offset at the visual start or end of the line box containing
 * `current` (bidi rule M3), for `pen.caretLineStart` / `pen.caretLineEnd`.
 *
 * Returns `null` when there is no DOM, no mounted block, or no line box —
 * callers fall back to the logical block edge, which is what keeps the
 * commands working headlessly.
 *
 * Offsets are scored by collapsed-`Range` caret-x rather than
 * `GeometryReader.caretRect`, which disagrees with Firefox by one offset at a
 * bidi space. The scan runs inside `measureWithRoot`, so it belongs to a read
 * phase (SCH2) even though the checker cannot see that through the call chain.
 */
function measureVisualLineEdge(
	current: VisualLinePoint,
	edge: VisualLineEdge,
): VisualLinePoint | null {
	if (typeof document === "undefined") {
		return null;
	}
	const block = document.querySelector(
		`[${DATA_ATTRS.blockId}="${current.blockId}"]`,
	);
	if (!(block instanceof HTMLElement)) {
		return null;
	}
	const root =
		block.closest(`[${DATA_ATTRS.editorRoot}]`) ??
		block.closest(`[${DATA_ATTRS.editorContent}]`);
	if (!(root instanceof HTMLElement)) {
		return null;
	}
	const inline = findInlineContentElement(block);
	const host = inline ?? block;
	const rtl =
		block.getAttribute("dir") === "rtl" ||
		getComputedStyle(block).direction === "rtl" ||
		getComputedStyle(host).direction === "rtl";

	return measureWithRoot(root, (geometry) => {
		const lines = geometry.reader.lineBoxes(current.blockId);
		if (lines.length === 0) {
			return null;
		}
		const line =
			lines.find(
				(box) =>
					current.offset >= box.startOffset &&
					current.offset <= box.endOffset,
			) ?? lines[0];
		if (!line) {
			return null;
		}
		const runRects = line.runs.map((entry) => entry.rect);
		if (runRects.length === 0) {
			return null;
		}
		const lineLeft = Math.min(...runRects.map((rect) => rect.left));
		const lineRight = Math.max(...runRects.map((rect) => rect.right));
		if (lineRight - lineLeft < 8) {
			return null;
		}
		const lineTop = Math.min(...runRects.map((rect) => rect.top));
		const lineBottom = Math.max(...runRects.map((rect) => rect.bottom));
		const targetX =
			edge === "start"
				? rtl
					? lineRight
					: lineLeft
				: rtl
					? lineLeft
					: lineRight;

		let length = 0;
		const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node instanceof Text) {
				length += node.data.length;
			}
		}

		let bestOffset = current.offset;
		let bestDist = Number.POSITIVE_INFINITY;
		const start = line.startOffset;
		const end = Math.min(line.endOffset, length);
		for (let offset = start; offset <= end; offset += 1) {
			const x = caretXAt(host, offset);
			if (x == null) {
				continue;
			}
			const y = caretYAt(host, offset);
			if (y != null && (y < lineTop - 2 || y > lineBottom + 2)) {
				continue;
			}
			const dist = Math.abs(x - targetX);
			if (dist < bestDist) {
				bestDist = dist;
				bestOffset = offset;
			}
		}
		if (bestDist === Number.POSITIVE_INFINITY) {
			const hit = geometry.reader.pointAt(
				targetX,
				(lineTop + lineBottom) / 2,
			);
			if (hit && hit.blockId === current.blockId) {
				return hit;
			}
			return null;
		}
		return { blockId: current.blockId, offset: bestOffset };
	});
}

function caretXAt(host: HTMLElement, offset: number): number | null {
	const rect = collapsedCaretRect(host, offset);
	return rect ? rect.left : null;
}

function caretYAt(host: HTMLElement, offset: number): number | null {
	const rect = collapsedCaretRect(host, offset);
	return rect ? rect.top : null;
}

function collapsedCaretRect(host: HTMLElement, offset: number): DOMRect | null {
	const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	let remaining = offset;
	let node: Text | null = null;
	let offsetInNode = 0;
	while (walker.nextNode()) {
		const current = walker.currentNode;
		if (!(current instanceof Text)) {
			continue;
		}
		if (remaining <= current.data.length) {
			node = current;
			offsetInNode = remaining;
			break;
		}
		remaining -= current.data.length;
	}
	if (!node) {
		return null;
	}
	const range = document.createRange();
	range.setStart(node, offsetInNode);
	range.collapse(true);
	const rect = range.getBoundingClientRect();
	if (
		rect.left === 0 &&
		rect.top === 0 &&
		rect.width === 0 &&
		rect.height === 0
	) {
		return null;
	}
	return rect;
}
