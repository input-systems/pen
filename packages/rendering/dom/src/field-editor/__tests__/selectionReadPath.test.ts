// @vitest-environment jsdom

import { createEditor, getEditorSelectionRecord } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { isSingleFieldNativeLeftover } from "../singleFieldNativeLeftover";
import { FieldEditorImpl } from "../fieldEditorImpl";

class ProbeFieldEditor extends FieldEditorImpl {
	divergenceRequests = 0;

	constructor(editor: ConstructorParameters<typeof FieldEditorImpl>[0]) {
		super(editor);
		const project = this.projector.requestDivergenceProjection.bind(
			this.projector,
		);
		this.projector.requestDivergenceProjection = (read) => {
			this.divergenceRequests += 1;
			project(read);
		};
	}
}

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

function seedEditor(
	fieldEditorFactory?: (
		editor: ReturnType<typeof createEditor>,
	) => FieldEditorImpl,
) {
	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = fieldEditorFactory
		? fieldEditorFactory(editor)
		: new FieldEditorImpl(editor);
	fixtures.push({ editor, fieldEditor });
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "hello" },
	]);
	editor.selectText(blockId, 0, 0);
	fieldEditor.activate(blockId);
	return { editor, fieldEditor, blockId };
}

function seedProbeEditor() {
	const seeded = seedEditor((editor) => new ProbeFieldEditor(editor));
	return {
		...seeded,
		fieldEditor: seeded.fieldEditor as ProbeFieldEditor,
	};
}

describe("FieldEditorImpl.readDomSelection PR 6", () => {
	it("step 4: a closed window does not write the authority", () => {
		const { editor, fieldEditor, blockId } = seedEditor();
		const before = getEditorSelectionRecord(editor)!;

		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});

		expect(decision).toBe("diverge");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
		});
		expect(getEditorSelectionRecord(editor)?.version).toBe(before.version);
	});

	it("step 5: an open pointer window writes origin pointer", () => {
		const { editor, fieldEditor, blockId } = seedEditor();
		fieldEditor.reader.notifyGesture("pointerdown");

		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});

		expect(decision).toBe("accept");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});
		expect(getEditorSelectionRecord(editor)?.origin).toBe("pointer");
	});

	it("step 5: an open ime window writes origin ime", () => {
		const { editor, fieldEditor, blockId } = seedEditor();
		fieldEditor.reader.notifyGesture("compositionstart");

		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
		});

		expect(decision).toBe("accept");
		expect(getEditorSelectionRecord(editor)?.origin).toBe("ime");
	});

	it("step 5: a same-ids block proposal without head keeps T4 head first", () => {
		const { editor, fieldEditor, blockId } = seedEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "second",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		editor.setSelection({
			type: "block",
			blockIds: [blockId, "second"],
			head: blockId,
		});
		fieldEditor.reader.notifyGesture("pointerdown");

		const decision = fieldEditor.readDomSelection({
			type: "block",
			blockIds: [blockId, "second"],
		});

		expect(decision).toBe("accept");
		expect(editor.selection).toMatchObject({
			type: "block",
			blockIds: [blockId, "second"],
			head: blockId,
		});
	});

	it("PR 6: a pointerdown gesture opens the window and does not mute reads", () => {
		const { fieldEditor } = seedEditor();
		fieldEditor.reader.notifyGesture("pointerdown");
		expect(fieldEditor.reader.isAdmissibleRead()).toBe(true);
	});

	it("I4: a closed-window cell caret move through the reader diverges and requests P2", () => {
		const { editor, fieldEditor, blockId } = seedProbeEditor();
		editor.selectText(blockId, 1, 1);
		const before = getEditorSelectionRecord(editor)!;

		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});

		expect(decision).toBe("diverge");
		expect(fieldEditor.divergenceRequests).toBe(1);
		expect(getEditorSelectionRecord(editor)?.version).toBe(before.version);
	});

	it("document-select-all leftover through the reader diverges and does not request P2", () => {
		const { editor, fieldEditor, blockId } = seedProbeEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "second",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "second",
				from: 0,
				to: 0,
				insert: "world",
			},
		]);
		editor.selectTextRange(
			{ blockId, offset: 0 },
			{ blockId: "second", offset: 5 },
		);
		const leftover = {
			type: "text" as const,
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
		};
		expect(isSingleFieldNativeLeftover(editor.selection, leftover)).toBe(
			true,
		);
		const before = getEditorSelectionRecord(editor)!;

		const decision = fieldEditor.readDomSelection(leftover);

		expect(decision).toBe("diverge");
		expect(fieldEditor.divergenceRequests).toBe(0);
		expect(getEditorSelectionRecord(editor)?.version).toBe(before.version);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId: "second", offset: 5 },
		});
	});

	it("a collapsed pointer read inside a multi-block selection is accepted and collapses it", () => {
		const { editor, fieldEditor, blockId } = seedProbeEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "second",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "second",
				from: 0,
				to: 0,
				insert: "world",
			},
		]);
		editor.selectTextRange(
			{ blockId, offset: 0 },
			{ blockId: "second", offset: 5 },
		);
		fieldEditor.reader.notifyGesture("pointerdown");

		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});

		expect(decision).toBe("accept");
		expect(fieldEditor.divergenceRequests).toBe(0);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});
	});

	it("a single-field range read is refused while a pointer window is open and re-projects", () => {
		const { editor, fieldEditor, blockId } = seedProbeEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "second",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "second",
				from: 0,
				to: 0,
				insert: "world",
			},
		]);
		// the host promoted the drag across blocks from pointer geometry
		editor.selectTextRange(
			{ blockId, offset: 0 },
			{ blockId: "second", offset: 5 },
		);
		fieldEditor.reader.notifyGesture("pointerdown");
		const before = getEditorSelectionRecord(editor)!;

		// the engine cannot represent that far end, so it reports the
		// nearest text end inside the origin field instead
		const decision = fieldEditor.readDomSelection({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
		});

		expect(decision).toBe("diverge");
		expect(fieldEditor.divergenceRequests).toBe(1);
		expect(getEditorSelectionRecord(editor)?.version).toBe(before.version);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId: "second", offset: 5 },
		});
	});
});
