// @vitest-environment jsdom

import { createEditor, getEditorSelectionRecord } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";
import { createSelectionReader } from "../selectionReader";

const fixtures: Array<{
	editor: Editor;
	fieldEditor: FieldEditorImpl;
	root: HTMLElement;
}> = [];

afterEach(() => {
	vi.restoreAllMocks();
	for (const fixture of fixtures.splice(0)) {
		fixture.fieldEditor.destroy();
		fixture.root.remove();
		fixture.editor.destroy();
	}
	document.getSelection()?.removeAllRanges();
});

/** A mounted root with blocks A ("hello world") and B ("second block"), editing A. */
function seed() {
	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = new FieldEditorImpl(editor);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.appendChild(root);
	const blockA = editor.firstBlock()!.id;
	editor.apply([
		{
			type: "splice-text",
			blockId: blockA,
			from: 0,
			to: 0,
			insert: "hello world",
		},
	]);
	const blockB = crypto.randomUUID();
	editor.apply([
		{
			type: "insert-block",
			blockId: blockB,
			blockType: "paragraph",
			props: {},
			position: { after: blockA },
		},
		{
			type: "splice-text",
			blockId: blockB,
			from: 0,
			to: 0,
			insert: "second block",
		},
	]);
	const inlines = new Map<string, HTMLElement>();
	for (const [blockId, text] of [
		[blockA, "hello world"],
		[blockB, "second block"],
	] as const) {
		const block = document.createElement("div");
		block.setAttribute(DATA_ATTRS.editorBlock, "");
		block.setAttribute(DATA_ATTRS.blockId, blockId);
		const inline = document.createElement("div");
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		inline.textContent = text;
		block.appendChild(inline);
		root.appendChild(block);
		inlines.set(blockId, inline);
	}
	editor.selectText(blockA, 0, 0);
	fieldEditor.setRootElement(root);
	fieldEditor.activate(blockA);
	fixtures.push({ editor, fieldEditor, root });

	const inline = (blockId: string) => inlines.get(blockId)!;
	const press = (blockId: string, pointerType: "touch" | "mouse") => {
		inline(blockId).dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				pointerType,
			}),
		);
	};
	const release = async (
		type: "pointerup" | "pointercancel" = "pointerup",
	) => {
		document.dispatchEvent(new PointerEvent(type, { bubbles: true }));
		await Promise.resolve();
	};
	/** Moves the native range inside one block, as a drag or a handle does. */
	const nativeRange = (blockId: string, anchor: number, focus: number) => {
		const text = inline(blockId).firstChild!;
		document.getSelection()!.setBaseAndExtent(text, anchor, text, focus);
		document.dispatchEvent(new Event("selectionchange"));
	};
	const textState = (blockId: string, anchor: number, focus: number) => ({
		type: "text",
		anchor: { blockId, offset: anchor },
		focus: { blockId, offset: focus },
	});
	const record = () => {
		const current = getEditorSelectionRecord(editor);
		return current && { origin: current.origin, state: current.state };
	};
	return {
		editor,
		fieldEditor,
		root,
		blockA,
		blockB,
		inline,
		press,
		release,
		nativeRange,
		textState,
		record,
		windows: () => fieldEditor.getGestureWindows(),
	};
}

/** Pointerup listeners the document holds now: adds minus removes. */
function trackDocumentListeners(type: string) {
	const add = vi.spyOn(document, "addEventListener");
	const remove = vi.spyOn(document, "removeEventListener");
	const count = (spy: typeof add) =>
		spy.mock.calls.filter(([name]) => name === type).length;
	return {
		added: () => count(add),
		live: () => count(add) - count(remove),
	};
}

describe("gesture windows outlive a field session switch (R1–R3)", () => {
	it("R1: a press in block B keeps the pointer window open after the read that moves the session to B", async () => {
		const fixture = seed();
		fixture.press(fixture.blockB, "mouse");
		fixture.nativeRange(fixture.blockB, 2, 2);
		expect(fixture.fieldEditor.focusBlockId).toBe(fixture.blockB);
		expect(fixture.windows().pointer).toBe(true);

		// The drag continues in B: its reads are accepted as pointer.
		fixture.nativeRange(fixture.blockB, 2, 5);
		expect(fixture.record()).toMatchObject({
			origin: "pointer",
			state: fixture.textState(fixture.blockB, 2, 5),
		});
		await fixture.release();
		expect(fixture.windows().pointer).toBe(false);
	});

	it("R1: suspending the field for a pointer selection leaves the pointer window open", () => {
		const fixture = seed();
		fixture.press(fixture.blockB, "mouse");
		fixture.fieldEditor.suspendForPointerSelection();
		expect(fixture.fieldEditor.isEditing).toBe(false);
		expect(fixture.windows().pointer).toBe(true);
	});

	it("R1: a session switch binds no second document pointerup listener", async () => {
		const fixture = seed();
		const pointerup = trackDocumentListeners("pointerup");
		fixture.press(fixture.blockB, "mouse");
		fixture.fieldEditor.activate(fixture.blockB);
		fixture.press(fixture.blockB, "mouse");
		expect(pointerup.added()).toBe(1);
		await fixture.release();
		expect(pointerup.live()).toBe(0);
	});

	it("C1: a deactivation mid-composition closes the ime window it owned", () => {
		const fixture = seed();
		fixture.fieldEditor.notifyGestureEvent("compositionstart");
		fixture.press(fixture.blockB, "mouse");
		fixture.fieldEditor.activate(fixture.blockB);
		expect(fixture.windows()).toMatchObject({ ime: false, pointer: true });
	});
});

describe("pointercancel ends the pointer gesture (R1, I4)", () => {
	it("R1: a document pointercancel closes the pointer window as pointerup does", async () => {
		const fixture = seed();
		fixture.press(fixture.blockA, "touch");
		expect(fixture.windows().pointer).toBe(true);
		await fixture.release("pointercancel");
		expect(fixture.windows().pointer).toBe(false);

		// I4: a later read with every window closed does not write the record.
		const before = fixture.record();
		fixture.nativeRange(fixture.blockA, 1, 4);
		expect(fixture.record()).toEqual(before);
	});

	it("R1: pointercancel and pointerup each end one gesture; the listener pair is released", async () => {
		const fixture = seed();
		const pointerup = trackDocumentListeners("pointerup");
		const pointercancel = trackDocumentListeners("pointercancel");
		fixture.press(fixture.blockA, "touch");
		await fixture.release("pointercancel");
		expect(pointerup.live()).toBe(0);
		expect(pointercancel.live()).toBe(0);
		fixture.press(fixture.blockA, "mouse");
		await fixture.release("pointerup");
		expect(pointerup.live()).toBe(0);
		expect(pointercancel.live()).toBe(0);
	});
});

describe("reader listener lifecycle", () => {
	it("R1: detach releases the document settle listener and closes the windows", () => {
		const fixture = seed();
		const onGesture = vi.fn();
		const reader = createSelectionReader({
			editor: fixture.editor,
			read: () => "accept",
			onGesture,
		});
		reader.attach(fixture.root);
		const pointerup = trackDocumentListeners("pointerup");
		reader.notifyGesture("pointerdown");
		reader.detach();
		expect(pointerup.live()).toBe(0);
		expect(reader.isAdmissibleRead()).toBe(false);
		document.dispatchEvent(new PointerEvent("pointerup"));
		expect(onGesture).not.toHaveBeenCalledWith("pointerup");

		// A press on the next root binds one listener and ends once.
		reader.attach(fixture.root);
		reader.notifyGesture("pointerdown");
		document.dispatchEvent(new PointerEvent("pointerup"));
		expect(
			onGesture.mock.calls.filter(([kind]) => kind === "pointerup"),
		).toHaveLength(1);
	});

	it("a pointerup after destroy mid-gesture is a no-op", () => {
		const fixture = seed();
		const pointerup = trackDocumentListeners("pointerup");
		const focusable = fixture.inline(fixture.blockA);
		focusable.tabIndex = 0;
		fixture.press(fixture.blockA, "mouse");
		fixture.fieldEditor.destroy();
		expect(pointerup.live()).toBe(0);
		focusable.focus();
		const activate = vi.spyOn(fixture.fieldEditor, "activate");
		document.dispatchEvent(new PointerEvent("pointerup"));
		expect(activate).not.toHaveBeenCalled();
		expect(fixture.fieldEditor.isEditing).toBe(false);
	});
});
