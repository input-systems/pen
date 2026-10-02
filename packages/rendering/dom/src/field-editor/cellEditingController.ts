import type {
	ActiveCellCoord,
	FieldEditorFocusReason,
	PenFieldEditorFocusOptions,
} from "./controller";
import type { FieldEditorTextLike } from "./crdt";
import { resolveCellInlineElement } from "./contentResolution";
import { writeNativeCaretAtEnd } from "./selectionProjector";

type CellEditingControllerOptions = {
	getRootElement: () => HTMLElement | null;
	getYTextForCell: (
		blockId: string,
		row: number,
		col: number,
	) => FieldEditorTextLike | null;
	attachElement: (element: HTMLElement) => boolean;
	requestDomFocus: (
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options?: FocusOptions,
		policyOptions?: PenFieldEditorFocusOptions,
	) => boolean;
};

export class CellEditingController {
	private readonly options: CellEditingControllerOptions;
	private coord: ActiveCellCoord | null = null;

	constructor(options: CellEditingControllerOptions) {
		this.options = options;
	}

	get activeCellCoord(): ActiveCellCoord | null {
		return this.coord;
	}

	setActiveCell(blockId: string, row: number, col: number): void {
		this.coord = { blockId, row, col };
	}

	clear(): void {
		this.coord = null;
	}

	trySyncBackend(): void {
		const coord = this.coord;
		if (!coord) return;

		const ytext = this.options.getYTextForCell(
			coord.blockId,
			coord.row,
			coord.col,
		);
		if (!ytext) return;

		const cellEl = this.resolveCellElement(
			coord.blockId,
			coord.row,
			coord.col,
		);
		if (!cellEl) {
			return;
		}
		this.options.attachElement(cellEl);
		this.placeCaretInCell(cellEl);
	}

	placeCaretInCell(cellEl: HTMLElement): void {
		if (
			!this.options.requestDomFocus(cellEl, "cell", {
				preventScroll: true,
			})
		) {
			return;
		}
		writeNativeCaretAtEnd(cellEl);
	}

	resolveInlineElement(blockId: string): HTMLElement | null {
		const coord = this.coord;
		if (coord?.blockId !== blockId) {
			return null;
		}
		return this.resolveCellElement(coord.blockId, coord.row, coord.col);
	}

	resolveActiveCellElement(
		rootElement?: HTMLElement | null,
	): HTMLElement | null {
		const coord = this.coord;
		if (!coord) return null;
		return this.resolveCellElement(
			coord.blockId,
			coord.row,
			coord.col,
			rootElement,
		);
	}

	resolveCellElement(
		blockId: string,
		row: number,
		col: number,
		root?: HTMLElement | null,
	): HTMLElement | null {
		return resolveCellInlineElement(
			blockId,
			row,
			col,
			root ?? this.options.getRootElement(),
		);
	}
}
