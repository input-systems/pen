/**
 * DOM↔editor selection mapping.
 * Converts between browser points/ranges and (blockId, offset) pairs.
 */

import { DATA_ATTRS } from "../utils/dataAttributes";
import {
	getBlockSelectionRoleFromType,
	getSelectionLengthForRole,
} from "../utils/blockSelectionSemantics";
import { domPointToLogicalOffset, getLogicalNodeLength } from "./inlineAtomDom";
import {
	findBlockElement,
	findInlineContentElement,
	queryBlockElement,
} from "./selectionDomQueries";

export interface SelectionPoint {
	blockId: string;
	offset: number;
}

export type SelectionBoundary = "start" | "end";

export interface DirectionalSelectionOffsets {
	anchor: number;
	focus: number;
	start: number;
	end: number;
}

export interface ResolveSelectionPointOptions {
	preferredBoundary?: SelectionBoundary;
	previousPoint?: SelectionPoint | null;
}

function fallbackCharacterOffset(
	container: HTMLElement,
	targetNode: Node,
	targetOffset: number,
): number {
	return domPointToLogicalOffset(container, targetNode, targetOffset);
}

/**
 * Compute the character offset of a DOM point within an inline content container.
 * Uses DOM Range first so browser-native endpoints on mark wrapper elements map
 * to the same logical offsets as equivalent text-node endpoints.
 */
export function domPointToOffset(
	container: HTMLElement,
	targetNode: Node,
	targetOffset: number,
): number {
	if (targetNode !== container && !container.contains(targetNode)) {
		return fallbackCharacterOffset(container, targetNode, targetOffset);
	}

	return domPointToLogicalOffset(container, targetNode, targetOffset);
}

export function getBlockSurfaceRole(
	blockEl: HTMLElement,
): "editable-inline" | "structural" | "delegated" {
	const stamped = blockEl.getAttribute(DATA_ATTRS.surfaceRole);
	const role =
		stamped === "structural" || stamped === "delegated"
			? stamped
			: getBlockSelectionRoleFromType(
					blockEl.getAttribute(DATA_ATTRS.blockType),
				);
	// A delegated block with one text surface of its own (a code block) holds
	// text offsets, as core's selection does, whether or not expanded mode
	// has stamped it `delegated`; a table's cells do not.
	if (role === "delegated" && ownsTextSurface(blockEl)) {
		return "editable-inline";
	}
	return role;
}

function ownsTextSurface(blockEl: HTMLElement): boolean {
	const inlineEl = findInlineContentElement(blockEl);
	return (
		inlineEl !== null &&
		inlineEl.closest(`[${DATA_ATTRS.tableCell}]`) === null
	);
}

function getBlockTextLength(blockEl: HTMLElement): number {
	const inlineEl = findInlineContentElement(blockEl);
	if (inlineEl) {
		return getLogicalNodeLength(inlineEl);
	}
	return blockEl.textContent?.length ?? 0;
}

function getBlockSelectionLength(blockEl: HTMLElement): number {
	return getSelectionLengthForRole(
		getBlockSurfaceRole(blockEl),
		getBlockTextLength(blockEl),
	);
}

function getBoundaryOffset(
	blockEl: HTMLElement,
	side: SelectionBoundary,
): number {
	return side === "start" ? 0 : getBlockSelectionLength(blockEl);
}

function resolveBoundarySideFromOffset(
	currentOffset: number,
	maxOffset: number,
): SelectionBoundary {
	if (currentOffset <= 0) return "start";
	if (currentOffset >= maxOffset) return "end";
	return currentOffset <= maxOffset / 2 ? "start" : "end";
}

export function getBoundaryPointForBlockElement(
	blockEl: HTMLElement,
	side: SelectionBoundary,
): SelectionPoint | null {
	const blockId = blockEl.getAttribute("data-block-id");
	if (!blockId) return null;
	return {
		blockId,
		offset: getBoundaryOffset(blockEl, side),
	};
}

export function getBlockBoundaryPoint(
	root: HTMLElement,
	blockId: string,
	side: SelectionBoundary,
): SelectionPoint | null {
	const blockEl = queryBlockElement(root, blockId);
	if (!blockEl) return null;
	return getBoundaryPointForBlockElement(blockEl, side);
}

/**
 * Resolve a DOM selection point (node + offset within that node) into
 * a (blockId, characterOffset) pair relative to the editor root.
 */
export function resolveSelectionPoint(
	root: HTMLElement,
	node: Node,
	offset: number,
	options: ResolveSelectionPointOptions = {},
): SelectionPoint | null {
	const blockEl = findBlockElement(node, root);
	if (!blockEl) return resolveBlockGapPoint(root, node, offset);
	const blockId = blockEl.getAttribute("data-block-id");
	if (!blockId) return null;

	const surfaceRole = getBlockSurfaceRole(blockEl);
	if (surfaceRole !== "editable-inline") {
		const inlineEl = findInlineContentElement(blockEl);
		const snappedSide =
			options.preferredBoundary ??
			(inlineEl && inlineEl.contains(node)
				? resolveBoundarySideFromOffset(
						domPointToOffset(inlineEl, node, offset),
						getBlockSelectionLength(blockEl),
					)
				: "start");
		return getBoundaryPointForBlockElement(blockEl, snappedSide);
	}

	const inlineEl = findInlineContentElement(blockEl);
	if (!inlineEl) return { blockId, offset: 0 };

	if (!inlineEl.contains(node)) return { blockId, offset: 0 };

	const charOffset = domPointToOffset(inlineEl, node, offset);
	return { blockId, offset: charOffset };
}

/**
 * The inverse of `findDOMPoint` for a block with no inline content (N2): the
 * projector writes such a block's `0..1` extent as the gaps around its
 * element, `(parent, index)` and `(parent, index + 1)`. A point in a gap
 * between block elements maps to the unit block on its left at 1, else the
 * unit block on its right at 0, else the nearer edge of a text block.
 */
function resolveBlockGapPoint(
	root: HTMLElement,
	node: Node,
	offset: number,
): SelectionPoint | null {
	if (!(node instanceof Element) || !root.contains(node)) return null;
	const before = node.childNodes[offset - 1];
	const after = node.childNodes[offset];
	const blockBefore = asBlockElement(before);
	const blockAfter = asBlockElement(after);
	if (blockBefore && !findInlineContentElement(blockBefore)) {
		return getBoundaryPointForBlockElement(blockBefore, "end");
	}
	if (blockAfter && !findInlineContentElement(blockAfter)) {
		return getBoundaryPointForBlockElement(blockAfter, "start");
	}
	if (blockBefore) return getBoundaryPointForBlockElement(blockBefore, "end");
	if (blockAfter) return getBoundaryPointForBlockElement(blockAfter, "start");
	return null;
}

function asBlockElement(node: Node | undefined): HTMLElement | null {
	return node instanceof HTMLElement && node.hasAttribute(DATA_ATTRS.editorBlock)
		? node
		: null;
}

/**
 * Convert DOM selection range to editor (blockId, offset) pairs.
 */
/** Maps `sel` (by default the live document selection) inside `root`. */
export function domSelectionToEditor(
	root: HTMLElement,
	sel: Selection | null = window.getSelection(),
): { anchor: SelectionPoint; focus: SelectionPoint } | null {
	if (!sel || sel.rangeCount === 0) return null;

	const anchorNode = sel.anchorNode;
	const focusNode = sel.focusNode;
	if (!anchorNode || !focusNode) return null;
	if (!root.contains(anchorNode) || !root.contains(focusNode)) return null;

	const anchor = resolveSelectionPoint(root, anchorNode, sel.anchorOffset);
	const focus = resolveSelectionPoint(root, focusNode, sel.focusOffset);
	if (!anchor || !focus) return null;

	return { anchor, focus };
}
