import { createEditor, getCommandRegistry } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { handleFieldEditorKeyDown } from "../keyHandling";

const fixtures: Array<ReturnType<typeof createEditor>> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		fixtures.pop()?.destroy();
	}
});

function createArrowEvent(key: string, shiftKey = false) {
	let defaultPrevented = false;
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey,
		altKey: false,
		isComposing: false,
		defaultPrevented,
		preventDefault() {
			defaultPrevented = true;
			Object.defineProperty(this, "defaultPrevented", {
				configurable: true,
				value: true,
			});
		},
	} as KeyboardEvent;
}

function insertTable(editor: ReturnType<typeof createEditor>, blockId: string) {
	editor.apply(
		[
			{
				type: "insert-block",
				blockId,
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId,
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "cell",
			},
		],
		{ origin: "user" },
	);
}

function createCellFieldEditor(editor: ReturnType<typeof createEditor>) {
	return {
		focusBlockId: "t",
		inputMode: "table" as const,
		activeCellCoord: { blockId: "t", row: 0, col: 0 },
		activateCell: () => {},
		activateTextSelection: () => {},
		syncCellTextSelection: (
			cell: { blockId: string; row: number; col: number },
			anchor: number,
			focus: number,
		) => {
			editor.setSelection(
				{
					type: "cell",
					blockId: cell.blockId,
					anchor: { row: cell.row, col: cell.col },
					head: { row: cell.row, col: cell.col },
					text: { anchor, focus },
				},
				{ origin: "keyboard" },
			);
		},
		deactivate: () => {},
		selectAllBehavior: "block-first" as const,
	};
}

const CELL_YTEXT = {
	length: 4,
	toString: () => "cell",
	toDelta: () => [{ insert: "cell" }],
	insert: () => {},
	delete: () => {},
};

describe("handleTableCellKey arrows", () => {
	it("T6: ArrowRight in an edited cell dispatches pen.caretRight, preventDefaults and moves CellSelection.text", () => {
		const editor = createEditor({ schema: defaultSchema });
		fixtures.push(editor);
		insertTable(editor, "t");
		editor.setSelection({
			type: "cell",
			blockId: "t",
			anchor: { row: 0, col: 0 },
			head: { row: 0, col: 0 },
			text: { anchor: 1, focus: 1 },
		});

		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const dispatched: string[] = [];
		const originalDispatch = registry.dispatch.bind(registry);
		registry.dispatch = ((command, param, context) => {
			dispatched.push(command.name);
			return originalDispatch(command, param, context);
		}) as typeof registry.dispatch;

		const event = createArrowEvent("ArrowRight");
		expect(
			handleFieldEditorKeyDown({
				event,
				editor,
				fieldEditor: createCellFieldEditor(editor),
				ytext: CELL_YTEXT,
				range: { start: 1, end: 1 },
			}),
		).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(dispatched).toContain("pen.caretRight");
		expect(editor.selection).toMatchObject({
			type: "cell",
			head: { row: 0, col: 0 },
			text: { anchor: 2, focus: 2 },
		});
	});

	it("T6: a cell with no caret in the record takes the field's range before the motion", () => {
		const editor = createEditor({ schema: defaultSchema });
		fixtures.push(editor);
		insertTable(editor, "t");
		editor.selectCell("t", 0, 0);

		const event = createArrowEvent("ArrowLeft");
		expect(
			handleFieldEditorKeyDown({
				event,
				editor,
				fieldEditor: createCellFieldEditor(editor),
				ytext: CELL_YTEXT,
				range: { start: 3, end: 3 },
			}),
		).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "cell",
			text: { anchor: 2, focus: 2 },
		});
	});
});
