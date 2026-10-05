import type { CommandResult, Editor, SelectionState } from "@input/pen-types";

import {
	blockSelectionResult,
	emitCommandDiagnostic,
	getBlockInputMode,
	isEditableTextBlock,
	readTextAffinity,
	readTextFocus,
} from "./helpers";
import {
	handleCellEditingCaret,
	handleCellSelectionArrow,
} from "./caretCellEditing";
import {
	crossBlock,
	extendSelection,
	finishNonVertical,
	handleBlockSelectionArrow,
} from "./caretMotion";
import type { CaretMotionParam } from "./caretParams";
import {
	getVerticalCaretGoalX,
	getVerticalCaretMeasure,
	setVerticalCaretGoalX,
	type VerticalCaretDirection,
	type VerticalCaretPoint,
} from "./verticalCaret";

export function handleVerticalCaret(
	editor: Editor,
	param: CaretMotionParam,
	direction: VerticalCaretDirection,
): CommandResult | false {
	const fromCellEdit = handleCellEditingCaret(editor, param, direction);
	if (fromCellEdit !== undefined) {
		return finishNonVertical(editor, fromCellEdit);
	}

	const fromBlock = handleBlockSelectionArrow(editor, param, direction);
	if (fromBlock !== undefined) {
		return finishNonVertical(editor, fromBlock);
	}

	const fromCell = handleCellSelectionArrow(editor, param, direction);
	if (fromCell !== undefined) {
		return finishNonVertical(editor, fromCell);
	}

	const focus = readTextFocus(editor);
	if (!focus) {
		return false;
	}

	const measured = measureVerticalStep(
		editor,
		{ ...focus, affinity: readTextAffinity(editor) },
		direction,
	);
	if (measured) {
		const measuredBlockId = measured.point.blockId;
		if (getBlockInputMode(editor, measuredBlockId) === "table") {
			// T5: entering a table by a vertical arrow selects its edge cell —
			// the first row moving down, the last moving up — as a click on a
			// cell does. A text point on the table block has no field to
			// project into (S2). Shift extends over the table as a block.
			setVerticalCaretGoalX(editor, null);
			return {
				selection: param.extend
					? extendSelection(editor, true, blockSelectionResult([measuredBlockId]))
					: edgeCellSelection(editor, measuredBlockId, direction),
			};
		}
		if (!isEditableTextBlock(editor, measuredBlockId)) {
			// Block selection has no column. Drop goalX so the next
			// geometry step does not reuse a stale horizontal target (G5).
			setVerticalCaretGoalX(editor, null);
			return {
				selection: extendSelection(
					editor,
					param.extend,
					blockSelectionResult([measuredBlockId]),
				),
			};
		}
		setVerticalCaretGoalX(editor, measured.goalX);
		return {
			selection: extendSelection(editor, param.extend, measured.point),
		};
	}

	const block = editor.getBlock(focus.blockId);
	if (!block) {
		return false;
	}
	const atEdge = isVerticalBlockEdge(block.length(), focus.offset, direction);
	if (!atEdge) {
		if (!getVerticalCaretMeasure(editor)) {
			emitCommandDiagnostic(editor, {
				code: "caret-geometry-unavailable",
				level: "info",
				source: "commands",
				message:
					"pen.caretUp / pen.caretDown has no geometry; mid-block vertical motion is a no-op",
				remediation:
					"Register setVerticalCaretMeasure after createEditor().",
			});
			return true;
		}
		return false;
	}

	// Logical fallback has no column. Drop goalX so the next geometry
	// step does not reuse a stale horizontal target (G5).
	setVerticalCaretGoalX(editor, null);
	const crossed = crossBlock(
		editor,
		focus.blockId,
		verticalCrossDirection(direction),
	);
	if (!crossed) {
		return { selection: extendSelection(editor, param.extend, focus) };
	}
	return { selection: extendSelection(editor, param.extend, crossed) };
}

function verticalCrossDirection(
	direction: VerticalCaretDirection,
): "previous" | "next" {
	switch (direction) {
		case "up":
			return "previous";
		case "down":
			return "next";
		default: {
			const _exhaustive: never = direction;
			return _exhaustive;
		}
	}
}

function isVerticalBlockEdge(
	length: number,
	offset: number,
	direction: VerticalCaretDirection,
): boolean {
	switch (direction) {
		case "up":
			return offset === 0;
		case "down":
			return offset === length;
		default: {
			const _exhaustive: never = direction;
			return _exhaustive;
		}
	}
}

function measureVerticalStep(
	editor: Editor,
	focus: VerticalCaretPoint,
	direction: VerticalCaretDirection,
): { point: { blockId: string; offset: number }; goalX: number } | null {
	const measure = getVerticalCaretMeasure(editor);
	if (!measure) {
		return null;
	}
	const result = measure(
		editor,
		focus,
		direction,
		getVerticalCaretGoalX(editor),
	);
	if (!result) {
		return null;
	}
	return result;
}

function edgeCellSelection(
	editor: Editor,
	blockId: string,
	direction: VerticalCaretDirection,
): SelectionState {
	const rows = editor.getBlock(blockId)?.as("table")?.tableRowCount() ?? 1;
	const row = direction === "up" ? Math.max(0, rows - 1) : 0;
	return {
		type: "cell",
		blockId,
		anchor: { row, col: 0 },
		head: { row, col: 0 },
	};
}

