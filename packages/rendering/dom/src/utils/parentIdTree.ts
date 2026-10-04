import {
	isContainerBlockType,
	shouldRenderContainerChildren,
} from "@input/pen-core";
import type { DocumentOp, Editor } from "@input/pen-types";

export function getRootBlockIds(editor: Editor): readonly string[] {
	return editor.documentState.blockOrder.filter(
		(blockId) => editor.documentState.parentOf(blockId) == null,
	);
}

/**
 * Whether `nextId` is the sibling right after `previousId` in model order —
 * the same sibling list (`childrenOf`, or the root list), with nothing
 * between them. DOM parentage cannot answer this once AX1 list groups wrap
 * some siblings and not others.
 */
export function areAdjacentSiblingBlocks(
	editor: Editor,
	previousId: string,
	nextId: string,
): boolean {
	const state = editor.documentState;
	const parentId = state.parentOf(previousId);
	if (previousId === nextId || parentId !== state.parentOf(nextId)) return false;
	if (parentId !== null) {
		const siblings = state.childrenOf(parentId);
		const index = siblings.indexOf(previousId);
		return index >= 0 && siblings[index + 1] === nextId;
	}
	const start = state.indexOf(previousId);
	if (start < 0) return false;
	// `parentId` children follow their parent in `blockOrder`; skip them.
	for (let index = start + 1; index < state.blockCount; index += 1) {
		const blockId = state.blockAt(index);
		if (blockId !== null && state.parentOf(blockId) == null) return blockId === nextId;
	}
	return false;
}

/**
 * The first and last top-level blocks, in `getRootBlockIds` order, without
 * building the list: `parentId` children only ever follow their parent in
 * `blockOrder`, so the walk from each end stops at the first root block.
 */
export function getRootBlockEndpoints(editor: Editor): {
	readonly firstBlockId: string | null;
	readonly lastBlockId: string | null;
} {
	const state = editor.documentState;
	const isRoot = (index: number) => {
		const blockId = state.blockAt(index);
		return blockId !== null && state.parentOf(blockId) == null ? blockId : null;
	};
	let firstBlockId: string | null = null;
	for (let index = 0; index < state.blockCount && firstBlockId === null; index += 1) {
		firstBlockId = isRoot(index);
	}
	let lastBlockId: string | null = null;
	for (let index = state.blockCount - 1; index >= 0 && lastBlockId === null; index -= 1) {
		lastBlockId = isRoot(index);
	}
	return { firstBlockId, lastBlockId };
}

/** Child ids of a container, covering both the children array and `parentId` routes. */
export function getChildBlockIds(
	editor: Editor,
	parentBlockId: string,
): readonly string[] {
	return editor.documentState.childrenOf(parentBlockId);
}

/**
 * @deprecated Renamed to {@link getChildBlockIds}, which covers both nesting
 * routes rather than only `parentId`. Kept for 0.1.x consumers of this subpath.
 */
export const getParentIdChildBlockIds = getChildBlockIds;

export function getVisibleBlockIds(editor: Editor): readonly string[] {
	const visibleBlockIds: string[] = [];

	for (const rootBlockId of getRootBlockIds(editor)) {
		collectVisibleBlockIds(editor, rootBlockId, visibleBlockIds);
	}

	return visibleBlockIds;
}

export function getAdjacentVisibleBlockId(
	editor: Editor,
	blockId: string,
	direction: "previous" | "next",
): string | null {
	const visibleBlockIds = getVisibleBlockIds(editor);
	const blockIndex = visibleBlockIds.indexOf(blockId);
	if (blockIndex < 0) return null;

	const adjacentIndex =
		direction === "previous" ? blockIndex - 1 : blockIndex + 1;
	return visibleBlockIds[adjacentIndex] ?? null;
}

export function isInsideParentIdContainer(
	editor: Editor,
	blockId: string,
): boolean {
	const parentId = editor.documentState.parentOf(blockId);
	if (!parentId) return false;
	const parent = editor.getBlock(parentId);
	return !!parent && isContainerBlockType(editor, parent.type);
}

export function appendParentIdChildBlock(
	editor: Editor,
	options: {
		parentBlockId: string;
		childBlockId: string;
		blockType: string;
		props?: Record<string, unknown>;
	},
): void {
	const { parentBlockId, childBlockId, blockType, props } = options;
	const insertionAnchorId =
		getLastDescendantBlockId(editor, parentBlockId) ?? parentBlockId;

	editor.apply(
		[
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType,
				props: props ?? {},
				position: { after: insertionAnchorId },
			},
			{
				type: "set-props",
				blockId: childBlockId,
				props: { parentId: parentBlockId },
			},
		],
		{ origin: "user" },
	);
}

export function getInsertSiblingBlockOp(
	editor: Editor,
	options: {
		siblingBlockId: string;
		blockId: string;
		blockType: string;
		props?: Record<string, unknown>;
	},
): DocumentOp {
	const { siblingBlockId, blockId, blockType, props } = options;
	const insertionAnchorId =
		getLastDescendantBlockId(editor, siblingBlockId) ?? siblingBlockId;
	const siblingParentId = editor.documentState.parentOf(siblingBlockId);
	const nextProps = { ...(props ?? {}) };

	if (
		siblingParentId &&
		!Object.prototype.hasOwnProperty.call(nextProps, "parentId")
	) {
		nextProps.parentId = siblingParentId;
	}

	return {
		type: "insert-block",
		blockId,
		blockType,
		props: nextProps,
		position: { after: insertionAnchorId },
	} as DocumentOp;
}

export function getLastDescendantBlockId(
	editor: Editor,
	parentBlockId: string,
): string | null {
	const blockOrder = editor.documentState.blockOrder;
	let lastDescendantBlockId: string | null = null;

	for (const blockId of blockOrder) {
		if (isDescendantOf(editor, blockId, parentBlockId)) {
			lastDescendantBlockId = blockId;
		}
	}

	return lastDescendantBlockId;
}

function collectVisibleBlockIds(
	editor: Editor,
	blockId: string,
	visibleBlockIds: string[],
): void {
	visibleBlockIds.push(blockId);

	if (!shouldRenderContainerChildren(editor, editor.getBlock(blockId))) {
		return;
	}

	for (const childBlockId of getChildBlockIds(editor, blockId)) {
		collectVisibleBlockIds(editor, childBlockId, visibleBlockIds);
	}
}

function isDescendantOf(
	editor: Editor,
	blockId: string,
	ancestorBlockId: string,
): boolean {
	let currentParentId = editor.documentState.parentOf(blockId);
	while (currentParentId) {
		if (currentParentId === ancestorBlockId) {
			return true;
		}
		currentParentId = editor.documentState.parentOf(currentParentId);
	}
	return false;
}
