import type { Editor } from "@input/pen-types";
import { measureWithRoot } from "../geometry/rootGeometry";
import { DATA_ATTRS } from "../utils/dataAttributes";
import type { FieldEditorDelta } from "./crdt";
import { domPointToLogicalOffset } from "./inlineAtomDom";
import type { TextDiffOp } from "./textDiff";
import { findInlineContentElement } from "./selectionDomQueries";
import { isDomHTMLElement, isDomText } from "../utils/domNodes";

const LINE_EDGE_SEAM = Symbol.for("pen.lineEdgeSeam");

type LineEdgeMeasure = (
	editor: Editor,
	current: { blockId: string; offset: number },
	edge: "start" | "end",
) => { blockId: string; offset: number } | null;

/** The document of the field that last handled a key, per editor. */
const lineEdgeDocuments = new WeakMap<Editor, Document>();

/**
 * Installs the DOM line-edge measure for `pen.caretLineStart` /
 * `pen.caretLineEnd` (M3), measuring in `doc`, the document of the field
 * handling the key, which is an iframe's when the host mounts there.
 */
export function ensureLineEdgeMeasure(editor: Editor, doc: Document): void {
	lineEdgeDocuments.set(editor, doc);
	const host = editor as unknown as Record<
		symbol,
		LineEdgeMeasure | undefined
	>;
	if (host[LINE_EDGE_SEAM]) {
		return;
	}
	// Keyed by the editor the seam is installed on: core may hand the
	// measure a different editor object (a view) for the same document.
	host[LINE_EDGE_SEAM] = (_measured, current, edge) => {
		const lineDoc = lineEdgeDocuments.get(editor);
		return lineDoc ? measureVisualLineEdge(lineDoc, current, edge) : null;
	};
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

	const startOffset = domPointToLogicalOffset(
		element,
		staticRange.startContainer,
		staticRange.startOffset,
	);
	const endOffset = domPointToLogicalOffset(
		element,
		staticRange.endContainer,
		staticRange.endOffset,
	);

	return {
		start: Math.min(startOffset, endOffset),
		end: Math.max(startOffset, endOffset),
	};
}

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
	ops: TextDiffOp[],
	deferredRemoteDeltas: ReadonlyArray<{ delta: FieldEditorDelta[] }>,
	baseLength: number,
): TextDiffOp[] {
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

	const result: TextDiffOp[] = [];
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
		skipToLive();
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

/**
 * C2, shared by the contenteditable and EditContext compositions: `ops`, a
 * composition's edit of its start text, rebased over the deltas deferred
 * while it ran, and the caret after the composed text. With nothing
 * deferred the edit stands and `caret` is null: the backend's own caret
 * holds.
 */
export function rebaseOverDeferredDeltas(
	ops: TextDiffOp[],
	deferredRemoteDeltas: ReadonlyArray<{ delta: FieldEditorDelta[] }>,
	baseLength: number,
): { diff: TextDiffOp[]; caret: number | null } {
	if (deferredRemoteDeltas.length === 0) {
		return { diff: ops, caret: null };
	}
	const diff = rebaseTextDiffOps(ops, deferredRemoteDeltas, baseLength);
	return { diff, caret: caretAfterRebasedDiff(diff) };
}

/** Where the caret sits after `rebased` applies: the end of the composed text. */
function caretAfterRebasedDiff(rebased: readonly TextDiffOp[]): number | null {
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
	deferredRemoteDeltas: ReadonlyArray<{ delta: FieldEditorDelta[] }>,
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
	deferredRemoteDeltas: ReadonlyArray<{ delta: FieldEditorDelta[] }>,
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
	deferredRemoteDeltas: ReadonlyArray<{ delta: FieldEditorDelta[] }>,
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
	doc: Document,
	current: VisualLinePoint,
	edge: VisualLineEdge,
): VisualLinePoint | null {
	const block = doc.querySelector(
		`[${DATA_ATTRS.blockId}="${current.blockId}"]`,
	);
	if (!isDomHTMLElement(block)) {
		return null;
	}
	const root =
		block.closest(`[${DATA_ATTRS.editorRoot}]`) ??
		block.closest(`[${DATA_ATTRS.editorContent}]`);
	if (!isDomHTMLElement(root)) {
		return null;
	}
	const inline = findInlineContentElement(block);
	const host = inline ?? block;
	const view = doc.defaultView;
	const rtl =
		block.getAttribute("dir") === "rtl" ||
		view?.getComputedStyle(block).direction === "rtl" ||
		view?.getComputedStyle(host).direction === "rtl";

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
		const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (isDomText(node)) {
				length += node.data.length;
			}
		}

		let bestOffset = current.offset;
		let bestDist = Number.POSITIVE_INFINITY;
		const start = line.startOffset;
		const end = Math.min(line.endOffset, length);
		for (let offset = start; offset <= end; offset += 1) {
			const caret = collapsedCaretRect(host, offset);
			if (
				!caret ||
				caret.top < lineTop - 2 ||
				caret.top > lineBottom + 2
			) {
				continue;
			}
			const dist = Math.abs(caret.left - targetX);
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

function collapsedCaretRect(host: HTMLElement, offset: number): DOMRect | null {
	const doc = host.ownerDocument;
	const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
	let remaining = offset;
	let node: Text | null = null;
	let offsetInNode = 0;
	while (walker.nextNode()) {
		const current = walker.currentNode;
		if (!isDomText(current)) {
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
	const range = doc.createRange();
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
