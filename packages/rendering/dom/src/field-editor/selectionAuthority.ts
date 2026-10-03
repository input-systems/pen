export type FieldEditorSelectionSource =
	| "programmatic"
	| "edit-context-textupdate"
	| "cell";

export type FieldEditorSelectionCell = {
	row: number;
	col: number;
};

export type FieldEditorSelectionSnapshot = {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
	cell?: FieldEditorSelectionCell;
};

export type FieldEditorTextSelectionLike = {
	type: "text";
	anchor: { blockId: string; offset: number };
	focus: { blockId: string; offset: number };
};

/** Structural view of `SelectionState`: only text endpoints are read here. */
export type FieldEditorLiveSelectionLike =
	| FieldEditorTextSelectionLike
	| { type: "block" | "app" | "cell" };

export type RestoreTextEndpoints = {
	anchor: { blockId: string; offset: number };
	focus: { blockId: string; offset: number };
};

/**
 * Live `editor.selection`, or null when it cannot address the field being
 * edited. A `TextSelection` carries no cell coordinate, so while a table cell
 * is active it describes the block and its offsets are a different coordinate
 * space than the cell's text. Cell edits deliberately leave `editor.selection`
 * alone for that reason (`textInputPipeline.applyInlineTextOperations`), so a
 * cell caret only ever lives in a cell-scoped stamp.
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
 * Endpoints to restore for a block field. A live editor selection outranks a
 * stamp, which may be left over from a superseded authority write.
 */
export function resolveRestoreTextEndpoints(
	blockId: string,
	liveSelection: FieldEditorTextSelectionLike | null,
	pending: FieldEditorSelectionSnapshot | null,
): RestoreTextEndpoints | null {
	if (liveSelection) {
		return { anchor: liveSelection.anchor, focus: liveSelection.focus };
	}
	if (!pending || pending.blockId !== blockId) {
		return null;
	}
	return {
		anchor: { blockId: pending.blockId, offset: pending.anchorOffset },
		focus: { blockId: pending.blockId, offset: pending.focusOffset },
	};
}

function stampAddressesCell(
	stamp: FieldEditorSelectionSnapshot | null,
	activeCell: FieldEditorSelectionCell,
): stamp is FieldEditorSelectionSnapshot {
	return (
		stamp != null &&
		stamp.cell?.row === activeCell.row &&
		stamp.cell?.col === activeCell.col
	);
}

/**
 * Cell-field restore. Addressability before liveness: a stamp must name
 * the active cell before it is ranked. Among addressable stamps the
 * programmatic one wins. An unaddressable stamp must not fall through to
 * block endpoints — `TextSelection` cannot express a cell caret.
 */
export function resolveRestoreCellEndpoints(
	pending: FieldEditorSelectionSnapshot | null,
	cellStamp: FieldEditorSelectionSnapshot | null,
	activeCell: FieldEditorSelectionCell,
): FieldEditorSelectionSnapshot | null {
	const addressablePending = stampAddressesCell(pending, activeCell)
		? pending
		: null;
	const addressableCell = stampAddressesCell(cellStamp, activeCell)
		? cellStamp
		: null;
	return addressablePending ?? addressableCell;
}

const DEFAULT_PRECEDENCE: readonly FieldEditorSelectionSource[] = [
	"programmatic",
	"edit-context-textupdate",
	"cell",
];

export class FieldEditorSelectionAuthority {
	private readonly selections = new Map<
		FieldEditorSelectionSource,
		FieldEditorSelectionSnapshot
	>();
	private applyingSelectionDepth = 0;

	get isApplyingSelection(): number {
		return this.applyingSelectionDepth;
	}

	set(
		source: FieldEditorSelectionSource,
		selection: FieldEditorSelectionSnapshot | null,
	): void {
		if (selection) {
			this.selections.set(source, selection);
			return;
		}
		this.selections.delete(source);
	}

	get(
		source: FieldEditorSelectionSource,
		blockId?: string | null,
	): FieldEditorSelectionSnapshot | null {
		const selection = this.selections.get(source) ?? null;
		if (!selection || (blockId && selection.blockId !== blockId)) {
			return null;
		}
		return selection;
	}

	has(source: FieldEditorSelectionSource): boolean {
		return this.selections.has(source);
	}

	resolve(
		blockId: string,
		sources: readonly FieldEditorSelectionSource[] = DEFAULT_PRECEDENCE,
	): FieldEditorSelectionSnapshot | null {
		for (const source of sources) {
			const selection = this.get(source, blockId);
			if (selection) {
				return selection;
			}
		}
		return null;
	}

	clear(source: FieldEditorSelectionSource): void {
		this.selections.delete(source);
	}

	reset(): void {
		this.selections.clear();
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
