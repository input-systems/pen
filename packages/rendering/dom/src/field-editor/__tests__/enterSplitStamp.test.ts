// @vitest-environment jsdom

import { createEditor, getEditorSelectionRecord } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { FieldEditorImpl } from "../fieldEditorImpl";

const fixtures: Array<{
	editor: ReturnType<typeof createEditor>;
	fieldEditor: FieldEditorImpl;
}> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		const fixture = fixtures.pop();
		if (!fixture) {
			break;
		}
		fixture.fieldEditor.destroy();
		fixture.editor.destroy();
	}
});

function seedSplitSession() {
	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = new FieldEditorImpl(editor);
	fixtures.push({ editor, fieldEditor });

	const firstBlockId = editor.firstBlock()!.id;
	editor.apply([
		{
			type: "splice-text",
			blockId: firstBlockId,
			from: 0,
			to: 0,
			insert: "Hello",
		},
		{
			type: "insert-block",
			blockId: "inserted",
			blockType: "paragraph",
			props: {},
			position: "last",
		},
	]);
	editor.selectText(firstBlockId, 5, 5);
	fieldEditor.activate(firstBlockId);
	fieldEditor.commitProgrammaticTextSelection("inserted", 0, 0);
	return { editor, fieldEditor, firstBlockId };
}

describe("enter-split leftover via readDomSelection", () => {
	it("diverges a leftover native range on the previous block and does not write authority", () => {
		const { editor, fieldEditor, firstBlockId } = seedSplitSession();
		const before = getEditorSelectionRecord(editor)!;

		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 5 },
			focus: { blockId: firstBlockId, offset: 5 },
		});

		expect(decision).toBe("diverge");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: "inserted", offset: 0 },
			focus: { blockId: "inserted", offset: 0 },
		});
		expect(getEditorSelectionRecord(editor)?.version).toBe(before.version);
	});

	it("still diverges leftover after a session-switch reset because it reads the record", () => {
		const { editor, fieldEditor, firstBlockId } = seedSplitSession();

		expect(fieldEditor.focusBlockId).toBe("inserted");
		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 5 },
			focus: { blockId: firstBlockId, offset: 5 },
		});

		expect(decision).toBe("diverge");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: "inserted", offset: 0 },
			focus: { blockId: "inserted", offset: 0 },
		});
	});

	it("accepts leftover on another block while a pointer window is open", () => {
		const { editor, fieldEditor, firstBlockId } = seedSplitSession();
		fieldEditor.reader.notifyGesture("pointerdown");

		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 5 },
			focus: { blockId: firstBlockId, offset: 5 },
		});

		expect(decision).toBe("accept");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 5 },
			focus: { blockId: firstBlockId, offset: 5 },
		});
	});
});
