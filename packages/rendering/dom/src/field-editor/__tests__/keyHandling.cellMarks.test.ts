import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { handleFieldEditorKeyDown } from "../keyHandling";

const fixtures: Array<ReturnType<typeof createEditor>> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		fixtures.pop()?.destroy();
	}
});

function createKeyEvent(
	key: string,
	modifiers: { metaKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
	return {
		key,
		ctrlKey: false,
		metaKey: modifiers.metaKey ?? false,
		shiftKey: modifiers.shiftKey ?? false,
		altKey: false,
		isComposing: false,
		defaultPrevented: false,
		preventDefault() {
			Object.defineProperty(this, "defaultPrevented", {
				configurable: true,
				value: true,
			});
		},
	} as KeyboardEvent;
}

const CELL_YTEXT = {
	length: 4,
	toString: () => "cell",
	toDelta: () => [{ insert: "cell" }],
	insert: () => {},
	delete: () => {},
};

function editedCellEditor() {
	const editor = createEditor({ schema: defaultSchema });
	fixtures.push(editor);
	editor.apply(
		[
			{
				type: "insert-block",
				blockId: "t",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "cell",
			},
		],
		{ origin: "user" },
	);
	editor.setSelection({
		type: "cell",
		blockId: "t",
		anchor: { row: 0, col: 0 },
		head: { row: 0, col: 0 },
		text: { anchor: 0, focus: 4 },
	});
	const diagnostics: Array<{ code: string; mark?: unknown }> = [];
	editor.on("diagnostic", (event) => {
		diagnostics.push(event as { code: string; mark?: unknown });
	});
	const fieldEditor = {
		focusBlockId: "t",
		inputMode: "table" as const,
		activeCellCoord: { blockId: "t", row: 0, col: 0 },
		activateCell: () => {},
		activateTextSelection: () => {},
		syncCellTextSelection: () => {},
		deactivate: () => {},
		selectAllBehavior: "block-first" as const,
	};
	return { editor, diagnostics, fieldEditor };
}

describe("FE6: mark accelerators in an edited cell", () => {
	it("FE6: Mod-b fails closed on keydown and reports cell-capability-unsupported", () => {
		const { editor, diagnostics, fieldEditor } = editedCellEditor();
		const event = createKeyEvent("b", { metaKey: true });

		expect(
			handleFieldEditorKeyDown({
				event,
				editor,
				fieldEditor,
				ytext: CELL_YTEXT,
				range: { start: 0, end: 4 },
			}),
		).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "cell-capability-unsupported",
				capability: "marks",
				mark: "bold",
			}),
		]);
	});

	it("FE6: a shifted accelerator is not a mark toggle and passes through", () => {
		const { editor, diagnostics, fieldEditor } = editedCellEditor();
		const event = createKeyEvent("b", { metaKey: true, shiftKey: true });

		handleFieldEditorKeyDown({
			event,
			editor,
			fieldEditor,
			ytext: CELL_YTEXT,
			range: { start: 0, end: 4 },
		});

		expect(event.defaultPrevented).toBe(false);
		expect(diagnostics).toEqual([]);
	});
});
