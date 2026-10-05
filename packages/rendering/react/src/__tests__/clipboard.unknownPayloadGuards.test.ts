// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { handleClipboardPaste } from "@input/pen-dom/field-editor/clipboard";
import {
	createClipboardData,
	createEditor,
	createFieldEditorStub,
} from "./utils/clipboardTestHelpers";

describe("@input/pen-react clipboard: unknown payload guards", () => {
	it("does not direct-paste unknown pen block payloads in flow documents", () => {
		const targetEditor = createEditor({
			documentProfile: "flow",
		});
		const emptyBlockId = targetEditor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		targetEditor.apply([
			{
				type: "splice-text",
				blockId: emptyBlockId,
				from: 0,
				to: 0,
				insert: "Hello",
			},
		]);
		targetEditor.selectText(emptyBlockId, 0, 5);
		clipboardData.setData(
			"application/x-pen-blocks",
			JSON.stringify([
				{ type: "customWidget", props: {}, content: "Ignored" },
			]),
		);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			targetEditor,
			fieldEditor,
		);

		expect(targetEditor.documentState.blockOrder).toHaveLength(1);
		expect(targetEditor.getBlock(emptyBlockId)?.textContent()).toBe(
			"Hello",
		);

		targetEditor.destroy();
	});
});
