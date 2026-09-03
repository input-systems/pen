import { useEffect, useState } from "react";
import { isCollapsed, isMultiBlock } from "@input/pen-core";
import type { BlockHandle, Editor } from "@input/pen-types";

export interface SnapshotBlock {
	id: string;
	type: string;
	text: string;
	props: Record<string, unknown>;
	children: SnapshotBlock[];
}

export interface DocumentSnapshot {
	/** Bumps on every committed change. Useful for spotting stray writes. */
	generation: number;
	blockCount: number;
	selection: string;
	blocks: SnapshotBlock[];
}

/**
 * A plain-object copy of the document, refreshed as it changes.
 *
 * Two editor events cover everything a reader cares about: `commit` for
 * applied operations, local and remote alike, and `selectionChange` for the
 * caret. Reads are coalesced into one animation frame so a fast typist does
 * not re-serialise per keystroke.
 */
export function useDocumentSnapshot(
	editor: Editor,
	isEnabled: boolean,
): DocumentSnapshot {
	const [snapshot, setSnapshot] = useState(() => readSnapshot(editor));

	useEffect(() => {
		if (!isEnabled) {
			return;
		}

		let frame = 0;
		const scheduleRead = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() =>
				setSnapshot(readSnapshot(editor)),
			);
		};

		const unsubscribes = [
			editor.on("commit", scheduleRead),
			editor.on("selectionChange", scheduleRead),
		];

		scheduleRead();

		return () => {
			cancelAnimationFrame(frame);
			for (const unsubscribe of unsubscribes) {
				unsubscribe();
			}
		};
	}, [editor, isEnabled]);

	return snapshot;
}

function readSnapshot(editor: Editor): DocumentSnapshot {
	const topLevelBlocks = editor.documentState.blockOrder
		.map((blockId) => editor.getBlock(blockId))
		.filter(
			(block): block is BlockHandle =>
				block !== null && block.parent === null,
		);

	return {
		generation: editor.documentState.generation,
		blockCount: editor.documentState.blockOrder.length,
		selection: describeSelection(editor),
		blocks: topLevelBlocks.map(readBlock),
	};
}

function readBlock(block: BlockHandle): SnapshotBlock {
	return {
		id: block.id,
		type: block.type,
		text: block.textContent(),
		props: block.props ?? {},
		children: block.children.map(readBlock),
	};
}

function describeSelection(editor: Editor): string {
	const selection = editor.selection;
	if (!selection) {
		return "none";
	}

	switch (selection.type) {
		case "text": {
			const { anchor, focus } = selection;
			if (isCollapsed(selection)) {
				return `caret at ${anchor.offset}`;
			}
			if (isMultiBlock(selection)) {
				return `text across blocks, ${anchor.offset} → ${focus.offset}`;
			}
			return `text ${anchor.offset} → ${focus.offset}`;
		}
		case "block":
			return `${selection.blockIds.length} block(s)`;
		case "cell":
			return `cells in ${selection.blockId}`;
		case "app":
			return `app ${selection.appId}`;
		default: {
			const unhandled: never = selection;
			return String(unhandled);
		}
	}
}
