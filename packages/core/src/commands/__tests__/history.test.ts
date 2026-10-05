import { describe, expect, it, vi } from "vitest";
import type { UndoManager } from "@input/pen-types";

import { historyRedo, historyUndo } from "..";
import { createCommandEditor, createCommandHarness } from "./fixture";

function installUndoManager(
	editor: ReturnType<typeof createCommandEditor>,
	overrides: Partial<UndoManager> = {},
): UndoManager {
	const manager: UndoManager = {
		undo: () => false,
		redo: () => false,
		canUndo: () => false,
		canRedo: () => false,
		stopCapturing: () => {},
		withCapture: (_origin, _groupId, run) => run(),
		setGroupTimeout: () => {},
		registerTrackedOrigins: () => () => {},
		onStackChange: () => () => {},
		...overrides,
	};
	editor.internals.assignSlot("undo:manager", manager);
	return manager;
}

describe("history commands", () => {
	it("history.undo is a miss when the undo controller cannot undo", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "hi" },
		]);
		const undo = vi.fn(() => true);
		installUndoManager(editor, {
			canUndo: () => false,
			undo,
		});
		const registry = createCommandHarness(editor);

		expect(registry.dispatch(historyUndo, undefined)).toBe(false);
		expect(undo).not.toHaveBeenCalled();
		editor.destroy();
	});

	it("history.undo dispatches to the undo controller facet", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "hi" },
		]);
		const undo = vi.fn(() => true);
		installUndoManager(editor, {
			canUndo: () => true,
			undo,
		});
		const registry = createCommandHarness(editor);

		expect(registry.dispatch(historyUndo, undefined)).toBe(true);
		expect(undo).toHaveBeenCalledOnce();
		editor.destroy();
	});

	it("history.redo dispatches to the undo controller facet", () => {
		const editor = createCommandEditor([
			{ id: "a", type: "paragraph", text: "hi" },
		]);
		const redo = vi.fn(() => true);
		installUndoManager(editor, {
			canRedo: () => true,
			redo,
		});
		const registry = createCommandHarness(editor);

		expect(registry.dispatch(historyRedo, undefined)).toBe(true);
		expect(redo).toHaveBeenCalledOnce();
		editor.destroy();
	});
});
