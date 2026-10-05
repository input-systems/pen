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

function createParagraphEditor() {
	const editor = createEditor({ schema: defaultSchema });
	fixtures.push(editor);
	const p1 = editor.firstBlock()!.id;
	editor.apply([
		{
			type: "splice-text",
			blockId: p1,
			from: 0,
			to: 0,
			insert: "Alpha bravo",
		},
	]);
	return { editor, p1 };
}

/**
 * The intra-block half of FE10. A drag that starts inside a field leaves the
 * range to the browser, and the mapped read at mouseup commits it. A drag
 * anchored in host chrome never entered a field, so there is no native range
 * to inherit and this resolver owes the caller one.
 */
describe("resolvePointerDragSelection FE10", () => {
	it("resolves a same-block range for a host-chrome origin", () => {
		const { editor, p1 } = createParagraphEditor();
		const root = {} as HTMLElement;
		const gesture = createPointerSelectionGesture(editor, {
			blockId: p1,
			clientX: 4,
			clientY: 40,
			startedInHostChrome: true,
		});
		gesture.anchorPoint = { blockId: p1, offset: 0 };
		vi.mocked(pointToEditorSelectionPoint).mockReturnValue({
			blockId: p1,
			offset: 11,
		});

		const resolved = resolvePointerDragSelection(editor, root, gesture, {
			clientX: 600,
			clientY: 40,
		});

		expect(resolved).toEqual({
			mode: "mapped-text",
			anchorPoint: { blockId: p1, offset: 0 },
			focusPoint: { blockId: p1, offset: 11 },
		});
	});

	it("leaves a same-block range to the browser for an in-field origin", () => {
		const { editor, p1 } = createParagraphEditor();
		const root = {} as HTMLElement;
		const gesture = createPointerSelectionGesture(editor, {
			blockId: p1,
			clientX: 40,
			clientY: 40,
		});
		gesture.anchorPoint = { blockId: p1, offset: 0 };
		vi.mocked(pointToEditorSelectionPoint).mockReturnValue({
			blockId: p1,
			offset: 11,
		});

		const resolved = resolvePointerDragSelection(editor, root, gesture, {
			clientX: 600,
			clientY: 40,
		});

		expect(resolved).toBeNull();
	});

	it("resolves nothing when a host-chrome drag has not left its offset", () => {
		const { editor, p1 } = createParagraphEditor();
		const root = {} as HTMLElement;
		const gesture = createPointerSelectionGesture(editor, {
			blockId: p1,
			clientX: 4,
			clientY: 40,
			startedInHostChrome: true,
		});
		gesture.anchorPoint = { blockId: p1, offset: 0 };
		vi.mocked(pointToEditorSelectionPoint).mockReturnValue({
			blockId: p1,
			offset: 0,
		});

		const resolved = resolvePointerDragSelection(editor, root, gesture, {
			clientX: 6,
			clientY: 44,
		});

		expect(resolved).toBeNull();
	});
});
