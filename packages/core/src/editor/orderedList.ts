import type { BlockHandle } from "@input/pen-types";

const NUMBERED_LIST_BLOCK_TYPE = "numberedListItem";

/**
 * A numbered list item's value: the numbered items before it in its sibling
 * list — the list AX1 groups it in (`getListSegments`) — at its indent,
 * counted back to a shallower item or any other block, from the nearest
 * `start`. A sibling list is the root list, a container's `parentId`
 * children, or a `children` array; blocks nested under an earlier sibling
 * are not its siblings, so a numbered item after a blockquote holding
 * numbered children starts at 1.
 */
export function getNumberedListItemValue(
	block: BlockHandle | null | undefined,
): number | null {
	if (!block || block.type !== NUMBERED_LIST_BLOCK_TYPE) {
		return null;
	}

	const startOverride = getStartOverride(block);
	if (startOverride !== undefined) {
		return startOverride;
	}

	const indent = getIndent(block);
	let count = 1;

	for (const previousBlock of previousSiblings(block)) {
		if (previousBlock.type !== NUMBERED_LIST_BLOCK_TYPE) {
			break;
		}

		const previousIndent = getIndent(previousBlock);
		if (previousIndent < indent) {
			break;
		}

		if (previousIndent === indent) {
			const previousStart = getStartOverride(previousBlock);
			if (previousStart !== undefined) {
				count += previousStart;
				break;
			}
			count++;
		}
	}

	return count;
}

/**
 * The blocks before `block` in its sibling list, nearest first. A block in
 * the root order walks `prev`, skipping blocks under another parent (an
 * earlier sibling's `parentId` children) and stopping at its own parent. A
 * block with no `prev` and no `parentId` may sit in a `children` array: its
 * siblings are its layout parent's children.
 */
function* previousSiblings(block: BlockHandle): Iterable<BlockHandle> {
	const parentId = getParentId(block);
	let previousBlock = block.prev;
	if (!previousBlock) {
		if (parentId !== null) return;
		const siblings = block.parent?.children ?? [];
		const index = siblings.findIndex((sibling) => sibling.id === block.id);
		for (let at = index - 1; at >= 0; at -= 1) {
			yield siblings[at] as BlockHandle;
		}
		return;
	}
	for (; previousBlock; previousBlock = previousBlock.prev) {
		if (previousBlock.id === parentId) return;
		if (getParentId(previousBlock) === parentId) yield previousBlock;
	}
}

function getParentId(block: BlockHandle): string | null {
	const parentId = block.props?.parentId;
	return typeof parentId === "string" && parentId !== "" ? parentId : null;
}

function getIndent(block: BlockHandle): number {
	const rawIndent = block.props?.indent;
	return typeof rawIndent === "number" && rawIndent >= 0 ? rawIndent : 0;
}

function getStartOverride(block: BlockHandle): number | undefined {
	const rawStart = block.props?.start;
	return typeof rawStart === "number" && rawStart > 0 ? rawStart : undefined;
}
