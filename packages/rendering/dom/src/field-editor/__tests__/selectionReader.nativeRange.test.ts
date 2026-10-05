// @vitest-environment jsdom

import { createEditor, getEditorSelectionRecord } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";
import {
	CLOSED_GESTURE_WINDOWS,
	createSelectionReader,
	isAdmissibleDomRead,
	nextGestureWindowState,
} from "../selectionReader";

const fixtures: Array<{
	editor: ReturnType<typeof createEditor>;
	fieldEditor: FieldEditorImpl;
	root: HTMLElement;
}> = [];

afterEach(() => {
	vi.useRealTimers();
	for (const fixture of fixtures.splice(0)) {
		fixture.fieldEditor.destroy();
		fixture.root.remove();
		fixture.editor.destroy();
	}
	document.getSelection()?.removeAllRanges();
});

/** A mounted root whose active field reads "hello world". */
function seed() {
	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = new FieldEditorImpl(editor);
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	document.body.appendChild(root);
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: "hello world" },
	]);
	editor.selectText(blockId, 0, 0);
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = "hello world";
	block.appendChild(inline);
	root.appendChild(block);
	fieldEditor.setRootElement(root);
	fieldEditor.activate(blockId);
	fixtures.push({ editor, fieldEditor, root });
	const text = inline.firstChild!;

	/** A press and release; the pointer window closes at pointer-settled. */
	const tap = async (pointerType: "touch" | "pen" | "mouse") => {
		inline.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				pointerType,
			}),
		);
		document.dispatchEvent(
			new PointerEvent("pointerup", { bubbles: true, pointerType }),
		);
		await Promise.resolve();
	};
	/** The engine's long-press signal, targeted at the text node. */
	const selectStart = () => {
		text.dispatchEvent(new Event("selectstart", { bubbles: true }));
	};
	/** Moves the native range, as a long-press or a handle drag does. */
	const nativeRange = (anchor: number, focus: number) => {
		document.getSelection()!.setBaseAndExtent(text, anchor, text, focus);
		document.dispatchEvent(new Event("selectionchange"));
	};
	const record = () => {
		const current = getEditorSelectionRecord(editor);
		return current && { origin: current.origin, state: current.state };
	};
	const textRecord = (
		anchor: number,
		focus: number,
		origin: string = "pointer",
	) => ({
		origin,
		state: {
			type: "text",
			anchor: { blockId, offset: anchor },
			focus: { blockId, offset: focus },
		},
	});
	return {
		editor,
		fieldEditor,
		blockId,
		tap,
		selectStart,
		nativeRange,
		record,
		textRecord,
		windows: () => fieldEditor.reader.windows,
	};
}

/** Long-press on "hello": a coarse press, its selectstart and the word range. */
async function longPressWord(fixture: ReturnType<typeof seed>) {
	await fixture.tap("touch");
	fixture.selectStart();
	fixture.nativeRange(0, 5);
}

describe("R1 native-range window for touch selection handles", () => {
	it("R1: the native-range window opens on a coarse-pointer selectstart followed by a non-collapsed range", async () => {
		const fixture = seed();
		await fixture.tap("touch");
		expect(fixture.windows().pointer).toBe(false);

		fixture.selectStart();
		expect(fixture.windows()).toMatchObject({
			nativeRange: false,
			nativeRangePending: true,
		});
		// A tap's selectstart places a caret: the collapsed read opens
		// nothing and drops the pending long-press.
		fixture.nativeRange(2, 2);
		expect(fixture.windows()).toMatchObject({
			nativeRange: false,
			nativeRangePending: false,
		});
		fixture.nativeRange(0, 5);
		expect(fixture.windows().nativeRange).toBe(false);

		// The long-press word opens it, and that read is accepted.
		await fixture.tap("touch");
		fixture.selectStart();
		fixture.nativeRange(0, 5);
		expect(fixture.windows()).toMatchObject({
			nativeRange: true,
			nativeRangePending: false,
		});
		expect(fixture.record()).toMatchObject(fixture.textRecord(0, 5));

		// A handle drag: selectionchange only, no pointer window.
		fixture.nativeRange(0, 8);
		expect(fixture.windows().pointer).toBe(false);
		expect(fixture.record()).toMatchObject(fixture.textRecord(0, 8));
		fixture.nativeRange(1, 8);
		expect(fixture.record()).toMatchObject(fixture.textRecord(1, 8));
		expect(fixture.windows().nativeRange).toBe(true);
	});

	it("R1: the native-range window opens on a coarse-pointer contextmenu (pen) followed by a non-collapsed range", async () => {
		const fixture = seed();
		await fixture.tap("pen");
		document
			.querySelector(`[${DATA_ATTRS.inlineContent}]`)!
			.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		fixture.nativeRange(6, 11);
		expect(fixture.windows().nativeRange).toBe(true);
		expect(fixture.record()).toMatchObject(fixture.textRecord(6, 11));
	});

	it("R1: the native-range window closes on an in-content pointerdown, on the collapsing read, and on a non-reader authority write", async () => {
		const fixture = seed();

		// The next in-content pointerdown.
		await longPressWord(fixture);
		expect(fixture.windows().nativeRange).toBe(true);
		await fixture.tap("touch");
		expect(fixture.windows()).toMatchObject({
			nativeRange: false,
			nativeRangePending: false,
		});

		// The collapsing read is decided inside the window, then closes it.
		await longPressWord(fixture);
		expect(fixture.windows().nativeRange).toBe(true);
		fixture.nativeRange(3, 3);
		expect(fixture.record()).toMatchObject(fixture.textRecord(3, 3));
		expect(fixture.windows().nativeRange).toBe(false);

		// A keyboard authority write supersedes the record.
		await longPressWord(fixture);
		expect(fixture.windows().nativeRange).toBe(true);
		fixture.editor.setSelection(
			{
				type: "text",
				anchor: { blockId: fixture.blockId, offset: 1 },
				focus: { blockId: fixture.blockId, offset: 4 },
			},
			{ origin: "keyboard" },
		);
		expect(fixture.windows().nativeRange).toBe(false);

		// So does a programmatic one; a later handle-style move then diverges
		// and does not write the authority (I4).
		await longPressWord(fixture);
		expect(fixture.windows().nativeRange).toBe(true);
		fixture.editor.selectText(fixture.blockId, 2, 4);
		expect(fixture.windows().nativeRange).toBe(false);
		fixture.nativeRange(0, 9);
		expect(fixture.record()).toMatchObject(
			fixture.textRecord(2, 4, "programmatic"),
		);
	});

	it("R1: a fine-pointer selectstart opens no native-range window", async () => {
		const fixture = seed();
		await fixture.tap("mouse");
		fixture.selectStart();
		expect(fixture.windows()).toMatchObject({
			nativeRange: false,
			nativeRangePending: false,
		});
		const before = fixture.record();
		fixture.nativeRange(0, 5);
		expect(fixture.windows().nativeRange).toBe(false);
		expect(fixture.record()).toEqual(before);
	});

	it("R1: the reader schedules no timer to open or close the native-range window", () => {
		vi.useFakeTimers();
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "hello" },
		]);
		const root = document.createElement("div");
		root.setAttribute(DATA_ATTRS.editorRoot, "");
		const block = document.createElement("div");
		block.setAttribute(DATA_ATTRS.editorBlock, "");
		block.setAttribute(DATA_ATTRS.blockId, blockId);
		const inline = document.createElement("span");
		inline.setAttribute(DATA_ATTRS.inlineContent, "");
		inline.textContent = "hello";
		block.append(inline);
		root.append(block);
		document.body.append(root);
		const text = inline.firstChild!;
		const read = vi.fn(() => "accept" as const);
		const reader = createSelectionReader({ editor, read });
		reader.attach(root);
		const unsubscribe = editor.onSelectionChange((record) =>
			reader.notifyAuthorityWrite(record.origin),
		);
		// jsdom queues its own selectionchange on a timer; deliver it, so
		// what remains queued after a step is the reader's.
		const moveNativeRange = (anchor: number, focus: number) => {
			document
				.getSelection()!
				.setBaseAndExtent(text, anchor, text, focus);
			vi.runAllTimers();
		};
		try {
			reader.notifyGesture("touch-selectstart");
			moveNativeRange(0, 5);
			expect(reader.windows.nativeRange).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
			moveNativeRange(2, 2);
			expect(reader.windows.nativeRange).toBe(false);
			expect(vi.getTimerCount()).toBe(0);
			reader.notifyGesture("touch-selectstart");
			moveNativeRange(0, 5);
			expect(reader.windows.nativeRange).toBe(true);
			editor.selectText(blockId, 1, 1);
			expect(reader.windows.nativeRange).toBe(false);
			expect(read).toHaveBeenCalled();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			unsubscribe();
			reader.detach();
			root.remove();
			editor.destroy();
		}
	});

	it("R1: native-range transitions are state only and admit a read only while open", () => {
		const pending = nextGestureWindowState(
			"touch-selectstart",
			CLOSED_GESTURE_WINDOWS,
		);
		expect(isAdmissibleDomRead("selectionchange", pending)).toBe(false);
		const open = nextGestureWindowState(
			"native-range-established",
			pending,
		);
		expect(open).toMatchObject({
			nativeRange: true,
			nativeRangePending: false,
		});
		expect(isAdmissibleDomRead("selectionchange", open)).toBe(true);
		// Established without a pending long-press opens nothing.
		expect(
			nextGestureWindowState(
				"native-range-established",
				CLOSED_GESTURE_WINDOWS,
			),
		).toEqual(CLOSED_GESTURE_WINDOWS);
		// The context-menu window's selectionchange close leaves it open.
		expect(
			nextGestureWindowState("selectionchange", open).nativeRange,
		).toBe(true);
		expect(
			nextGestureWindowState("native-range-collapsed", open).nativeRange,
		).toBe(false);
		expect(
			nextGestureWindowState("authority-superseded", open).nativeRange,
		).toBe(false);
		expect(nextGestureWindowState("pointerdown", open)).toMatchObject({
			pointer: true,
			nativeRange: false,
		});
	});
});
