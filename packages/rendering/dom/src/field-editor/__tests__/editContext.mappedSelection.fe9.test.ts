// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupMountedFields,
	mountField,
} from "./fieldEditorFixtures.testHelpers";

afterEach(cleanupMountedFields);

describe("FE9 EditContext trusted typing caret", () => {
	it("FE9: a mapped selectionChange clears the backend's trusted typing caret and the next textupdate inserts at the mapped caret", () => {
		const { editor, fieldEditor, blockId, editContext, text } = mountField(
			"hello world",
			{ editContext: true },
		);

		fieldEditor.activateTextSelection(blockId, 5, 5);
		editContext.textUpdate(5, 5, "x");
		expect(text()).toBe("hellox world");

		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 3, insert: "" }],
			{ origin: "user" },
		);
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId, offset: 3 },
		});
		expect(editContext.selectionStart).toBe(3);
		expect(editContext.selectionEnd).toBe(3);

		// a stale range: the pre-apply caret would put "y" at 6
		editContext.textUpdate(6, 6, "y");
		expect(text()).toBe("loxy world");
	});

	it("FE9: ordinary typing keeps the trusted typing caret against a stale range", () => {
		const { editor, fieldEditor, blockId, editContext, text } = mountField(
			"hello world",
			{ editContext: true },
		);

		fieldEditor.activateTextSelection(blockId, 5, 5);
		editContext.textUpdate(5, 5, "x");
		// a stale range: the buffer still reports the pre-keystroke caret
		editContext.textUpdate(5, 5, "y");

		expect(text()).toBe("helloxy world");
	});

	it("FE9: a programmatic selectText clears the trusted typing caret and the next textupdate inserts at the new caret", () => {
		const { editor, fieldEditor, blockId, editContext, text } = mountField(
			"hello world",
			{ editContext: true },
		);

		fieldEditor.activateTextSelection(blockId, 5, 5);
		editContext.textUpdate(5, 5, "x");

		editor.selectText(blockId, 2, 2);
		expect(editContext.selectionStart).toBe(2);
		// a stale range: the old trusted caret would put "y" at 6
		editContext.textUpdate(9, 9, "y");

		expect(text()).toBe("heyllox world");
	});
});
