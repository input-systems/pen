import type { BlockDecoration, Decoration, Editor, InlineDecoration } from "@input/pen-types";
import { createRemotePresenceAttributes } from "../presence/presenceAttributes";
import type { RemoteSelectionState } from "../types";

export function buildRemoteSelectionDecorations(
	editor: Editor,
	selections: readonly RemoteSelectionState[],
): Decoration[] {
	const decorations: Decoration[] = [];
	const blockOrder = editor.documentState.blockOrder;

	for (const selection of selections) {
		switch (selection.kind) {
			case "block":
				decorations.push(...buildBlockSelectionDecorations(selection));
				break;
			case "text":
				decorations.push(
					...buildSelectionDecorationsForRange(
						editor,
						blockOrder,
						selection,
					),
				);
				break;
			// a cell selection has no block text to decorate and no cell-scoped
			// decoration type to carry it. The table renderer paints these from
			// controller state instead.
			case "cell":
				break;
			default: {
				const _exhaustive: never = selection;
				return _exhaustive;
			}
		}
	}

	return decorations;
}

function buildBlockSelectionDecorations(
	selection: Extract<RemoteSelectionState, { kind: "block" }>,
): BlockDecoration[] {
	return selection.blockIds.map((blockId: string) => ({
		type: "block",
		blockId,
		position: "wrap",
		attributes: createRemotePresenceAttributes({
			className: "pen-multiplayer-block-selection",
			markerName: "data-pen-multiplayer-block-selection",
			clientId: selection.clientId,
			user: selection.user,
		}),
	}));
}

function buildSelectionDecorationsForRange(
	editor: Editor,
	blockOrder: readonly string[],
	selection: Extract<RemoteSelectionState, { kind: "text" }>,
): InlineDecoration[] {
	// O(1) per endpoint (SCALE2): the position index, not a scan of the order.
	const anchorIndex = editor.documentState.indexOf(selection.anchor.blockId);
	const headIndex = editor.documentState.indexOf(selection.head.blockId);
	if (anchorIndex < 0 || headIndex < 0) {
		return [];
	}

	if (anchorIndex === headIndex) {
		const from = Math.min(selection.anchor.offset, selection.head.offset);
		const to = Math.max(selection.anchor.offset, selection.head.offset);
		if (from === to) {
			return [];
		}
		return [
			createSelectionDecoration(selection, selection.anchor.blockId, from, to),
		];
	}

	const startIndex = Math.min(anchorIndex, headIndex);
	const endIndex = Math.max(anchorIndex, headIndex);
	const isForward = anchorIndex <= headIndex;
	const decorations: InlineDecoration[] = [];

	for (let index = startIndex; index <= endIndex; index += 1) {
		const blockId = blockOrder[index];
		const blockLength = resolveBlockLength(editor, blockId);

		let from = 0;
		let to = blockLength;

		if (index === startIndex) {
			from = isForward ? selection.anchor.offset : selection.head.offset;
		} else if (index === endIndex) {
			to = isForward ? selection.head.offset : selection.anchor.offset;
		}

		if (to <= from) {
			continue;
		}

		decorations.push(createSelectionDecoration(selection, blockId, from, to));
	}

	return decorations;
}

function createSelectionDecoration(
	selection: Extract<RemoteSelectionState, { kind: "text" }>,
	blockId: string,
	from: number,
	to: number,
): InlineDecoration {
	return {
		type: "inline",
		blockId,
		from,
		to,
		key: `multiplayer-selection:${selection.clientId}:${blockId}:${from}:${to}:${selection.clock}`,
		attributes: createRemotePresenceAttributes({
			className: "pen-multiplayer-selection",
			markerName: "data-pen-multiplayer-selection",
			clientId: selection.clientId,
			user: selection.user,
		}),
	};
}

function resolveBlockLength(editor: Editor, blockId: string): number {
	return editor.getBlock(blockId)?.textContent({ resolved: true }).length ?? 0;
}
