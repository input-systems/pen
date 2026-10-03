export type FieldEditorSelectionCell = {
	row: number;
	col: number;
};

export type FieldEditorTextSelectionLike = {
	type: "text";
	anchor: { blockId: string; offset: number };
	focus: { blockId: string; offset: number };
};

/** Structural view of `SelectionState`: text endpoints and an edited cell's `text`. */
export type FieldEditorLiveSelectionLike =
	| FieldEditorTextSelectionLike
	| { type: "block" | "app" }
	| {
			type: "cell";
			blockId?: string;
			head?: FieldEditorSelectionCell;
			text?: { anchor: number; focus: number };
	  };

/**
 * Live `editor.selection`, or null when it cannot address the field being
 * edited. A `TextSelection` carries no cell coordinate, so while a table cell
 * is active its offsets are a different coordinate space than the cell's
 * text; the edited cell's caret is `CellSelection.text` instead.
 */
export function resolveLiveTextSelection(
	selection: FieldEditorLiveSelectionLike | null | undefined,
	blockId: string,
	activeCell: FieldEditorSelectionCell | null,
): FieldEditorTextSelectionLike | null {
	if (activeCell) {
		return null;
	}
	if (
		selection?.type !== "text" ||
		selection.anchor.blockId !== blockId ||
		selection.focus.blockId !== blockId
	) {
		return null;
	}
	return selection;
}

/**
 * The edited cell's caret (W3.R18): the record's `CellSelection.text` when
 * it names `activeCell` in `blockId`, else null.
 */
export function resolveEditedCellText(
	selection: FieldEditorLiveSelectionLike | null | undefined,
	blockId: string,
	activeCell: FieldEditorSelectionCell,
): { anchor: number; focus: number } | null {
	if (
		selection?.type !== "cell" ||
		!selection.text ||
		selection.blockId !== blockId ||
		selection.head?.row !== activeCell.row ||
		selection.head?.col !== activeCell.col
	) {
		return null;
	}
	return selection.text;
}

export class FieldEditorSelectionAuthority {
	private applyingSelectionDepth = 0;

	get isApplyingSelection(): number {
		return this.applyingSelectionDepth;
	}

	reset(): void {
		this.applyingSelectionDepth = 0;
	}

	beginApplyingSelection(): () => void {
		this.applyingSelectionDepth += 1;
		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;
			this.applyingSelectionDepth = Math.max(
				0,
				this.applyingSelectionDepth - 1,
			);
		};
	}

	// mute echoes during the write; release in the same turn (S4)
	withSelectionWrite<T>(write: () => T): T {
		const endWrite = this.beginApplyingSelection();
		try {
			return write();
		} finally {
			endWrite();
		}
	}
}
