import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPointerSelectionGesture,
	resolvePointerDragSelection,
} from "../pointerSelection";

vi.mock("../../field-editor/selectionBridge", () => ({
	pointToEditorSelectionPoint: vi.fn(),
}));

import { pointToEditorSelectionPoint } from "../../field-editor/selectionBridge";

const fixtures: Array<ReturnType<typeof createEditor>> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		fixtures.pop()?.destroy();
	}
	vi.mocked(pointToEditorSelectionPoint).mockReset();
});

function createMixedBoundaryEditor() {
	const editor = createEditor({ schema: defaultSchema });
	fixtures.push(editor);
	const p1 = editor.firstBlock()!.id;
	editor.apply([
		{
			type: "insert-block",
			blockId: "d1",
			blockType: "divider",
			props: {},
			position: { after: p1 },
		},
	]);
	return { editor, p1 };
}

describe("resolvePointerDragSelection T2/N2", () => {
	it("keeps a paragraph-to-divider drag as text", () => {
		const { editor, p1 } = createMixedBoundaryEditor();
		editor.apply([
			{
				type: "splice-text",
				blockId: p1,
				from: 0,
				to: 0,
				insert: "Hello",
			},
		]);
		editor.selectText(p1, 2, 2);
		const root = {} as HTMLElement;
		const gesture = createPointerSelectionGesture(editor, {
			blockId: p1,
			clientX: 0,
			clientY: 0,
		});
		gesture.anchorPoint = { blockId: p1, offset: 2 };
		vi.mocked(pointToEditorSelectionPoint).mockReturnValue({
			blockId: "d1",
			offset: 1,
		});

		const resolved = resolvePointerDragSelection(editor, root, gesture, {
			clientX: 80,
			clientY: 40,
		});

		expect(resolved?.mode).not.toBe("block");
		expect(resolved).toMatchObject({
			mode: "canonical",
			anchorPoint: { blockId: p1, offset: 2 },
			focusPoint: { blockId: "d1" },
		});
	});

	it("keeps a divider-to-paragraph drag as text", () => {
		const { editor, p1 } = createMixedBoundaryEditor();
		const root = {} as HTMLElement;
		const gesture = createPointerSelectionGesture(editor, {
			blockId: "d1",
			clientX: 80,
			clientY: 40,
		});
		gesture.anchorPoint = { blockId: "d1", offset: 0 };
		vi.mocked(pointToEditorSelectionPoint).mockReturnValue({
			blockId: p1,
			offset: 2,
		});

		const resolved = resolvePointerDragSelection(editor, root, gesture, {
			clientX: 0,
			clientY: 0,
		});

		expect(resolved?.mode).not.toBe("block");
		expect(resolved).toMatchObject({
			mode: "canonical",
			anchorPoint: { blockId: "d1" },
			focusPoint: { blockId: p1 },
		});
	});
});
