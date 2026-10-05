import { createHeadlessEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { describe, expect, it } from "vitest";
import { getExpandedBlockRole } from "../crossBlock";

describe("getExpandedBlockRole", () => {
	it("G4 S2: a code block stays editable inside the expanded host; a table and a divider do not", () => {
		const editor = createHeadlessEditor({ schema: defaultSchema });
		const paragraphId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "insert-block",
				blockId: "code",
				blockType: "codeBlock",
				props: {},
				position: { after: paragraphId },
			},
			{
				type: "insert-block",
				blockId: "table",
				blockType: "table",
				props: {},
				position: { after: "code" },
			},
			{
				type: "insert-block",
				blockId: "divider",
				blockType: "divider",
				props: {},
				position: { after: "table" },
			},
		]);

		expect(getExpandedBlockRole(editor, paragraphId)).toBe("editable-inline");
		expect(getExpandedBlockRole(editor, "code")).toBe("editable-inline");
		expect(getExpandedBlockRole(editor, "table")).toBe("delegated");
		expect(getExpandedBlockRole(editor, "divider")).toBe("structural");

		editor.destroy();
	});
});
