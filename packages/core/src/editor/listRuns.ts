import type { BlockHandle, Editor } from "@input/pen-types";

import { LIST_BLOCK_TYPES } from "../commands/commandBlockContext";

/** Render-time list semantics of one list item (AX1). */
export interface ListItemSemantics {
	/** indent + 1, so a top-level item is level 1 */
	readonly level: number;
	/** 1-based position within its set */
	readonly posinset: number;
	readonly setsize: number;
	/** id of the first block of the DOM group the item renders in */
	readonly groupKey: string;
}

/** One entry of a partitioned sibling list: a run of list items, or any other block. */
export type ListSegment =
	| { readonly kind: "list"; readonly key: string; readonly blockIds: readonly string[] }
	| { readonly kind: "block"; readonly blockId: string };

interface ListItemFacts {
	readonly type: string;
	readonly level: number;
}

/** The block's list type and level, or null when it is not a list item. */
function listItemFacts(editor: Editor, blockId: string): ListItemFacts | null {
	const block = editor.getBlock(blockId);
	if (!block || !isListItemType(block.type)) return null;
	return { type: block.type, level: listItemLevel(block) };
}

/** `indent + 1`, reading `indent` the way the list renderers do; non-integers floor, negatives are 0. */
function listItemLevel(block: BlockHandle): number {
	const raw = block.props?.indent;
	const indent = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0;
	return Math.max(0, indent) + 1;
}

/**
 * One forward pass over a sibling list. `onItem` sees each list item with its
 * group's first id; `onBreak` sees each non-list sibling. A group is a maximal
 * run of list items, split where a level-1 item's type differs from the
 * previous level-1 item's in the run.
 */
function walkGroups(
	editor: Editor,
	siblingIds: readonly string[],
	onItem: (blockId: string, facts: ListItemFacts, groupKey: string, startsGroup: boolean) => void,
	onBreak: (blockId: string) => void,
): void {
	let groupKey: string | null = null;
	let topLevelType: string | null = null;
	for (const blockId of siblingIds) {
		const facts = listItemFacts(editor, blockId);
		if (!facts) {
			groupKey = null;
			topLevelType = null;
			onBreak(blockId);
			continue;
		}
		const startsGroup =
			groupKey === null ||
			(facts.level === 1 && topLevelType !== null && topLevelType !== facts.type);
		if (startsGroup) {
			groupKey = blockId;
			topLevelType = null;
		}
		if (facts.level === 1) topLevelType = facts.type;
		onItem(blockId, facts, groupKey as string, startsGroup);
	}
}

/**
 * Partitions one sibling list (`getRootBlockIds` or `documentState.childrenOf`,
 * never a `blockOrder` filter; RI6) into list groups and other blocks. O(n).
 * A list segment's key is its first block's id.
 */
export function getListSegments(editor: Editor, siblingIds: readonly string[]): readonly ListSegment[] {
	const segments: ListSegment[] = [];
	let current: string[] | null = null;
	walkGroups(
		editor,
		siblingIds,
		(blockId, _facts, groupKey, startsGroup) => {
			if (startsGroup || !current) {
				current = [];
				segments.push({ kind: "list", key: groupKey, blockIds: current });
			}
			current.push(blockId);
		},
		(blockId) => {
			current = null;
			segments.push({ kind: "block", blockId });
		},
	);
	return segments;
}

interface OpenSet {
	readonly type: string;
	readonly members: string[];
}

/**
 * Level, position and set size for every list item in one sibling list. O(n).
 * A set is the items of one level in one group that share their nearest
 * preceding shallower item; it also ends where two consecutive same-level
 * items differ in type. Positions come from the whole sibling list, never from
 * what is mounted (AX1).
 */
export function getListItemSemantics(
	editor: Editor,
	siblingIds: readonly string[],
): ReadonlyMap<string, ListItemSemantics> {
	const levels = new Map<string, number>();
	const groups = new Map<string, string>();
	const sets: string[][] = [];
	let open = new Map<number, OpenSet>();
	walkGroups(
		editor,
		siblingIds,
		(blockId, facts, groupKey, startsGroup) => {
			if (startsGroup) open = new Map();
			// A shallower or equal item closes every deeper set.
			for (const level of [...open.keys()]) {
				if (level > facts.level) open.delete(level);
			}
			let set = open.get(facts.level);
			if (!set || set.type !== facts.type) {
				set = { type: facts.type, members: [] };
				open.set(facts.level, set);
				sets.push(set.members);
			}
			set.members.push(blockId);
			levels.set(blockId, facts.level);
			groups.set(blockId, groupKey);
		},
		() => {
			open = new Map();
		},
	);
	const semantics = new Map<string, ListItemSemantics>();
	for (const members of sets) {
		members.forEach((blockId, index) => {
			semantics.set(blockId, {
				level: levels.get(blockId) as number,
				posinset: index + 1,
				setsize: members.length,
				groupKey: groups.get(blockId) as string,
			});
		});
	}
	return semantics;
}

/** Whether a block type is a list item under the AX1 grouping rules (`LIST_BLOCK_TYPES`). */
export function isListItemType(type: string | null | undefined): boolean {
	return type != null && LIST_BLOCK_TYPES.has(type);
}
