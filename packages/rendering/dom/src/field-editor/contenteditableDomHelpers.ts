import type { Editor } from "@input/pen-types";
import { measureWithRoot } from "../geometry/rootGeometry";
import { DATA_ATTRS } from "../utils/dataAttributes";
import type { FieldEditorDelta } from "./crdt";
import { findLogicalDOMPoint } from "./inlineAtomDom";
import { domPointToOffset, getSelectionOffsets } from "./selectionBridge";
import { findInlineContentElement } from "./selectionDomQueries";

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

export function canResolveInputRange(
	event: InputEvent,
	element: HTMLElement,
): boolean {
	if (event.inputType === "insertReplacementText") {
		const targetRanges = event.getTargetRanges?.();
		if (targetRanges?.length) {
			return staticRangeToOffsets(targetRanges[0], element) !== null;
		}
	}

	return getSelectionOffsets(element) !== null;
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

export function setSelectionOffsets(
	element: HTMLElement,
	startOffset: number,
	endOffset: number,
): void {
	const selection = element.ownerDocument?.getSelection();
	if (!selection) return;

	const startPoint = resolveDomPointForOffset(element, startOffset);
	const endPoint = resolveDomPointForOffset(element, endOffset);

	const intendedRange =
		startPoint.node !== endPoint.node ||
		startPoint.offset !== endPoint.offset;

	const setBaseAndExtent = (
		selection as Selection & {
			setBaseAndExtent?: (
				anchorNode: Node,
				anchorOffset: number,
				focusNode: Node,
				focusOffset: number,
			) => void;
		}
	).setBaseAndExtent;
	if (typeof setBaseAndExtent === "function") {
		try {
			setBaseAndExtent.call(
				selection,
				startPoint.node,
				startPoint.offset,
				endPoint.node,
				endPoint.offset,
			);
			if (
				!intendedRange ||
				(selection.rangeCount > 0 &&
					selection.anchorNode === startPoint.node &&
					selection.anchorOffset === startPoint.offset &&
					selection.focusNode === endPoint.node &&
					selection.focusOffset === endPoint.offset)
			) {
				return;
			}
		} catch {
			// Fall back to the range-based path in non-browser test environments.
		}
	}

	selection.removeAllRanges();

	const collapseRange = element.ownerDocument.createRange();
	collapseRange.setStart(startPoint.node, startPoint.offset);
	collapseRange.collapse(true);
	selection.addRange(collapseRange);

	if (intendedRange && typeof selection.extend === "function") {
		try {
			selection.extend(endPoint.node, endPoint.offset);
			if (!selection.isCollapsed) {
				return;
			}
		} catch {
			// Fall through to an ordered addRange.
		}
	}

	if (!intendedRange) {
		return;
	}

	selection.removeAllRanges();
	const range = element.ownerDocument.createRange();
	range.setStart(startPoint.node, startPoint.offset);
	range.setEnd(endPoint.node, endPoint.offset);
	selection.addRange(range);
}

function resolveDomPointForOffset(
	element: HTMLElement,
	targetOffset: number,
): { node: Node; offset: number } {
	return findLogicalDOMPoint(element, Math.max(0, targetOffset));
}

export function rebaseTextDiffOps(
	ops: Array<
		| { type: "insert"; offset: number; text: string }
		| { type: "delete"; offset: number; length: number }
	>,
	deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }>,
): Array<
	| { type: "insert"; offset: number; text: string }
	| { type: "delete"; offset: number; length: number }
> {
	if (deferredRemoteDeltas.length === 0 || ops.length === 0) {
		return ops;
	}

	return ops
		.map((op) => {
			if (op.type === "insert") {
				return {
					type: "insert" as const,
					offset: mapOffsetThroughRemoteDeltas(
						op.offset,
						deferredRemoteDeltas,
					),
					text: op.text,
				};
			}

			const start = mapOffsetThroughRemoteDeltas(
				op.offset,
				deferredRemoteDeltas,
			);
			const end = mapOffsetThroughRemoteDeltas(
				op.offset + op.length,
				deferredRemoteDeltas,
			);
			return {
				type: "delete" as const,
				offset: start,
				length: Math.max(0, end - start),
			};
		})
		.filter((op) => {
			if (op.type === "insert") {
				return true;
			}
			return op.length > 0;
		});
}

function mapOffsetThroughRemoteDeltas(
	originalOffset: number,
	deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }>,
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
					const deletedBeforeOffset = Math.min(
						part.delete,
						mappedOffset - cursor,
					);
					mappedOffset -= deletedBeforeOffset;
				}
				continue;
			}

			if (part.insert != null) {
				const insertedLength =
					typeof part.insert === "string" ? part.insert.length : 1;
				if (cursor <= mappedOffset) {
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
export type VisualLineEdge = "start" | "end";

/** A caret position as the line-edge measure addresses it. */
export type VisualLinePoint = {
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
export function measureVisualLineEdge(
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
