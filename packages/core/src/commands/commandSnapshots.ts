import type { BlockHandle, Editor, SelectionState } from "@input/pen-types";

import type {
	NormalPositionBlock,
	NormalPositionSnapshot,
} from "../selection/normalPosition";
import type {
	TransitionBlock,
	TransitionContainerKind,
	TransitionSnapshot,
	SelectionState as TransitionSelection,
} from "../selection/transitions";
import {
	getRootBlockIds,
	getVisibleBlockIds,
	isEditableTextBlock,
	LIST_BLOCK_TYPES,
	logicalInline,
	isContainerBlockType,
	shouldRenderContainerChildren,
} from "./commandBlockContext";
import { blockSelectionResult, textSelectionResult } from "./commandSelection";

/**
 * Captures a {@link NormalPositionSnapshot} from an editor's current document.
 *
 * Exported so renderers can feed `snapToNormalPosition` without building a second
 * adapter over the document shape; two snapshot builders would drift apart and the
 * snap rule would disagree with core about where a caret may legally sit.
 *
 * @param editor - The editor to read block order and block content from.
 * @returns A snapshot detached from the live document.
 */
export function buildNormalPositionSnapshot(
	editor: Editor,
): NormalPositionSnapshot {
	const blockOrder = [...getVisibleBlockIds(editor)];
	const blocks: Record<string, NormalPositionBlock> = {};
	for (const blockId of blockOrder) {
		const block = editor.getBlock(blockId);
		if (!block) {
			continue;
		}
		if (!isEditableTextBlock(editor, blockId)) {
			blocks[blockId] = { kind: "structural", text: "" };
			continue;
		}
		const logical = logicalInline(block);
		blocks[blockId] = {
			kind: "text",
			text: logical.text,
			atoms: logical.atoms,
		};
	}
	return { blockOrder, blocks };
}

/**
 * A {@link NormalPositionSnapshot} that reads the document on demand (SCALE2):
 * `has(id)` walks the block's parents, `blocks[id]` reads that block once, and
 * `blockOrder` is materialised only if a caller asks for it. The per-keystroke
 * DOM read and caret motion touch one or two blocks, so they read one or two
 * blocks rather than the whole document. Read it in the same turn it was built.
 */
export function buildLazyNormalPositionSnapshot(
	editor: Editor,
): NormalPositionSnapshot {
	let blockOrder: readonly string[] | null = null;
	const cache = new Map<string, NormalPositionBlock | undefined>();
	const blocks = new Proxy({} as Record<string, NormalPositionBlock>, {
		get(_target, key) {
			if (typeof key !== "string") return undefined;
			if (!cache.has(key)) cache.set(key, normalPositionBlock(editor, key));
			return cache.get(key);
		},
	});
	return {
		get blockOrder() {
			blockOrder ??= [...getVisibleBlockIds(editor)];
			return blockOrder;
		},
		blocks,
		has: (blockId) => isVisibleBlock(editor, blockId),
	};
}

function normalPositionBlock(editor: Editor, blockId: string): NormalPositionBlock | undefined {
	const block = editor.getBlock(blockId);
	if (!block) return undefined;
	if (!isEditableTextBlock(editor, blockId)) return { kind: "structural", text: "" };
	const logical = logicalInline(block);
	return { kind: "text", text: logical.text, atoms: logical.atoms };
}

/** In `getVisibleBlockIds`: a root in block order, or under open containers only. */
function isVisibleBlock(editor: Editor, blockId: string): boolean {
	const state = editor.documentState;
	if (!editor.getBlock(blockId)) return false;
	let current = blockId;
	for (let parent = state.parentOf(current); parent !== null; parent = state.parentOf(current)) {
		if (!shouldRenderContainerChildren(editor, editor.getBlock(parent))) return false;
		current = parent;
	}
	return state.indexOf(current) >= 0;
}

/**
 * Captures a {@link TransitionSnapshot} for the T functions.
 *
 * With `blockIds` the snapshot is scoped: it carries only those blocks, in
 * document order, which is all T2 (`convertPointerDrag`) and T5
 * (`clickSelectableBlock`) read. A pointer event pays for its endpoints, not
 * for the document (SCALE2).
 *
 * @param editor - The editor to read block order and block content from.
 * @param options - `blockIds` scopes the snapshot to those blocks.
 * @returns A snapshot detached from the live document.
 */
export function buildTransitionSnapshot(
	editor: Editor,
	options?: { readonly blockIds?: readonly string[] },
): TransitionSnapshot {
	const scoped = options?.blockIds;
	const blockOrder = scoped
		? scopedBlockOrder(editor, scoped)
		: [...getVisibleBlockIds(editor)];
	const blocks: Record<string, TransitionBlock> = {};
	for (const blockId of blockOrder) {
		const entry = transitionBlockFor(editor, blockId);
		if (entry) {
			blocks[blockId] = entry;
		}
	}
	return {
		blockOrder,
		topLevelIds: scoped
			? blockOrder.filter(
					(blockId) => editor.documentState.parentOf(blockId) == null,
				)
			: getRootBlockIds(editor),
		blocks,
	};
}

function scopedBlockOrder(
	editor: Editor,
	blockIds: readonly string[],
): string[] {
	const preorder = editor.documentState.preorderBlockIds();
	const unique = [...new Set(blockIds)].filter((blockId) =>
		editor.getBlock(blockId),
	);
	return unique.sort((a, b) => preorder.indexOf(a) - preorder.indexOf(b));
}

function transitionBlockFor(
	editor: Editor,
	blockId: string,
): TransitionBlock | null {
	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}
	const parentId = editor.documentState.parentOf(blockId);
	const listContainer = listContainerFor(editor, block);
	return {
		id: blockId,
		kind: isEditableTextBlock(editor, blockId) ? "text" : "structural",
		length: block.length(),
		parentId,
		containerId: listContainer?.id ?? parentId,
		containerKind: listContainer?.kind ?? parentContainerKind(editor, parentId),
	};
}

export function toTransitionSelection(editor: Editor): TransitionSelection {
	const selection = editor.selection;
	if (!selection) {
		return null;
	}
	switch (selection.type) {
		case "text":
			return {
				type: "text",
				anchor: selection.anchor,
				focus: selection.focus,
				affinity: selection.affinity ?? "downstream",
				goalX: selection.goalX ?? null,
			};
		case "block":
			return {
				type: "block",
				blockIds: selection.blockIds,
				head:
					selection.head ??
					selection.blockIds[selection.blockIds.length - 1] ??
					selection.blockIds[0] ??
					"",
			};
		case "cell":
			return {
				type: "cell",
				blockId: selection.blockId,
				anchor: selection.anchor,
				head: selection.head,
			};
		case "app":
			return { type: "app", appId: selection.appId };
		default: {
			const _exhaustive: never = selection;
			return _exhaustive;
		}
	}
}

export function fromTransitionSelection(
	selection: TransitionSelection,
	blockOrder?: readonly string[],
): SelectionState | null {
	if (!selection) {
		return null;
	}
	switch (selection.type) {
		case "text":
			return textSelectionResult(selection.anchor, selection.focus, {
				affinity: selection.affinity,
				goalX: selection.goalX,
				blockOrder,
			});
		case "block":
			return blockSelectionResult(selection.blockIds, selection.head);
		case "cell":
			return {
				type: "cell",
				blockId: selection.blockId,
				anchor: selection.anchor,
				head: selection.head,
			};
		case "app":
			return { type: "app", appId: selection.appId };
		default: {
			const _exhaustive: never = selection;
			return _exhaustive;
		}
	}
}

function listContainerFor(
	editor: Editor,
	block: BlockHandle,
): { id: string; kind: TransitionContainerKind } | null {
	if (!LIST_BLOCK_TYPES.has(block.type)) {
		return null;
	}
	const parentId = editor.documentState.parentOf(block.id) ?? "root";
	return {
		id: `list:${parentId}:${block.type}`,
		kind: "list",
	};
}

function parentContainerKind(
	editor: Editor,
	parentId: string | null,
): TransitionContainerKind | null {
	if (!parentId) {
		return null;
	}
	const parent = editor.getBlock(parentId);
	if (!parent) {
		return null;
	}
	if (parent.type === "table") {
		return "table";
	}
	if (isContainerBlockType(editor, parent.type)) {
		return "layout-cell";
	}
	return null;
}
