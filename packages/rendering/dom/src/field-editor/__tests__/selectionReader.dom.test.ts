// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CLOSED_GESTURE_WINDOWS,
	createSelectionReader,
	isAdmissibleDomRead,
	nextGestureWindowState,
	type ReaderSelection,
} from "../selectionReader";
import {
	destroyReaderFixtures,
	seedActiveField,
	seedTextRoot,
} from "./selectionReader.testHelpers";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	destroyReaderFixtures();
});

const TWO_BLOCKS = ["hello world", "second block"];

function caret(blockId: string, offset: number): ReaderSelection {
	return {
		type: "text",
		anchor: { blockId, offset },
		focus: { blockId, offset },
	};
}

/** Document listeners of `type` added so far, and those still live. */
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

/** A field over "hello world" with the long-press signals a touch engine sends. */
function seedTouchField() {
	const fixture = seedActiveField();
	/** A press and release; the pointer window closes at pointer-settled. */
	const tap = async (pointerType: "touch" | "pen" | "mouse") => {
		fixture.press(pointerType);
		await fixture.release();
	};
	/** The engine's long-press signal, targeted at the text node. */
	const selectStart = () => {
		fixture
			.inline()
			.firstChild!.dispatchEvent(
				new Event("selectstart", { bubbles: true }),
			);
	};
	/** Long-press on "hello": a coarse press, its selectstart and the word range. */
	const longPressWord = async () => {
		await tap("touch");
		selectStart();
		fixture.nativeRange(0, 5);
	};
	return { ...fixture, tap, selectStart, longPressWord };
}

describe("single selection reader (S1)", () => {
	it("S1: the reader's one selectionchange listener maps the live selection inside its root", () => {
		const { editor, blockId, root, placeCaret } = seedTextRoot();
		const read = vi.fn(() => "accept" as const);
		const reader = createSelectionReader({ editor, read });
		reader.attach(root);
		placeCaret(3);
		document.dispatchEvent(new Event("selectionchange"));
		expect(read).toHaveBeenCalledTimes(1);
		expect(read).toHaveBeenCalledWith(caret(blockId, 3));

		reader.detach();
		document.dispatchEvent(new Event("selectionchange"));
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("S1: a selection outside the root is no proposal", () => {
		const { editor, root } = seedTextRoot();
		const outside = document.createElement("p");
		outside.textContent = "elsewhere";
		document.body.append(outside);
		const read = vi.fn(() => "accept" as const);
		const reader = createSelectionReader({ editor, read });
		reader.attach(root);
		document.getSelection()!.collapse(outside.firstChild, 2);
		expect(reader.sync()).toBe("no-proposal");
		expect(read).not.toHaveBeenCalled();
		outside.remove();
	});

	it("R: an equivalent read stops at step 3 without the decision", () => {
		const { editor, blockId, root, placeCaret } = seedTextRoot();
		editor.selectText(blockId, 2, 2);
		const read = vi.fn(() => "equivalent" as const);
		const reader = createSelectionReader({ editor, read });
		reader.attach(root);
		placeCaret(2);
		expect(reader.sync()).toBe("equivalent");
		expect(read).not.toHaveBeenCalled();
	});

	it("R: a non-equivalent read goes to the decision; no backend pre-filters it (S1)", () => {
		const { editor, blockId, root, placeCaret } = seedTextRoot();
		editor.selectText(blockId, 0, 0);
		const read = vi.fn(() => "diverge" as const);
		const reader = createSelectionReader({ editor, read });
		reader.attach(root);
		placeCaret(4);
		expect(reader.sync()).toBe("diverge");
		expect(read).toHaveBeenCalledWith(caret(blockId, 4));
	});

	it("S1: the reader reads through its DOM port", () => {
		const { editor, blockId, root, placeCaret } = seedTextRoot();
		placeCaret(1);
		const getSelection = vi.fn((doc: Document) => doc.getSelection());
		const reader = createSelectionReader({
			editor,
			read: () => "accept",
			dom: { getSelection },
		});
		reader.attach(root);
		expect(reader.peek()).toEqual(caret(blockId, 1));
		expect(getSelection).toHaveBeenCalledWith(document);
	});
});

describe("reader gesture windows (R1–R3)", () => {
	it("R1: pointerdown opens the pointer window, which stays open after pointerup until pointer-settled", async () => {
		const { editor, root } = seedTextRoot();
		const onGesture = vi.fn();
		const reader = createSelectionReader({
			editor,
			read: () => "accept",
			onGesture,
		});
		reader.attach(root);
		expect(reader.isAdmissibleRead()).toBe(false);
		reader.notifyGesture("pointerdown");
		expect(reader.isAdmissibleRead()).toBe(true);
		reader.notifyGesture("pointerup");
		expect(reader.isAdmissibleRead()).toBe(true);
		await Promise.resolve();
		expect(reader.isAdmissibleRead()).toBe(false);
		expect(onGesture.mock.calls.map(([kind]) => kind)).toEqual([
			"pointerdown",
			"pointerup",
		]);
	});

	it("R1: the document pointerup reads the live selection while the pointer window is still open", () => {
		const { editor, blockId, root, placeCaret } = seedTextRoot();
		const windowsAtRead: boolean[] = [];
		const reader = createSelectionReader({
			editor,
			read: () => {
				windowsAtRead.push(reader.windows.pointer);
				return "accept";
			},
		});
		reader.attach(root);
		reader.notifyGesture("pointerdown");
		placeCaret(4);
		document.dispatchEvent(new Event("pointerup"));
		expect(windowsAtRead).toEqual([true]);
		expect(reader.peek()).toEqual(caret(blockId, 4));
	});

	it("R1: a pointerup that finds the press's native range unchanged reads nothing", () => {
		const { editor, root, placeCaret } = seedTextRoot();
		const read = vi.fn(() => "accept" as const);
		const reader = createSelectionReader({ editor, read });
		reader.attach(root);
		placeCaret(2);
		reader.notifyGesture("pointerdown");
		document.dispatchEvent(new Event("pointerup"));
		expect(read).not.toHaveBeenCalled();
	});

	it("R3: windows are independent; closing ime leaves an open pointer window", () => {
		const { editor, root } = seedTextRoot();
		const reader = createSelectionReader({ editor, read: () => "accept" });
		reader.attach(root);
		reader.notifyGesture("compositionstart");
		reader.notifyGesture("pointerdown");
		reader.notifyGesture("compositionend-completed");
		expect(reader.windows.ime).toBe(false);
		expect(reader.windows.pointer).toBe(true);
		reader.detach();
		expect(reader.isAdmissibleRead()).toBe(false);
	});

	it("R1: a non-equivalent selectionchange in the context-menu window is accepted and closes it", () => {
		const fixture = seedActiveField();
		fixture.nativeRange(0, 0);
		fixture
			.inline()
			.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		fixture.nativeRange(0, 5);
		expect(fixture.record()).toMatchObject(fixture.textRecord(0, 5));
		expect(fixture.windows().contextMenu).toBe(false);
		fixture.nativeRange(6, 11);
		expect(fixture.record()).toMatchObject(fixture.textRecord(0, 5));
	});
});

describe("R1 native-range window for touch selection handles", () => {
	it("R1: the native-range window opens on a coarse-pointer selectstart followed by a non-collapsed range", async () => {
		const fixture = seedTouchField();
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
		await fixture.longPressWord();
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
		const fixture = seedTouchField();
		await fixture.tap("pen");
		fixture
			.inline()
			.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		fixture.nativeRange(6, 11);
		expect(fixture.windows().nativeRange).toBe(true);
		expect(fixture.record()).toMatchObject(fixture.textRecord(6, 11));
	});

	it("R1: the native-range window closes on an in-content pointerdown, on the collapsing read, and on a non-reader authority write", async () => {
		const fixture = seedTouchField();

		// The next in-content pointerdown.
		await fixture.longPressWord();
		expect(fixture.windows().nativeRange).toBe(true);
		await fixture.tap("touch");
		expect(fixture.windows()).toMatchObject({
			nativeRange: false,
			nativeRangePending: false,
		});

		// The collapsing read is decided inside the window, then closes it.
		await fixture.longPressWord();
		expect(fixture.windows().nativeRange).toBe(true);
		fixture.nativeRange(3, 3);
		expect(fixture.record()).toMatchObject(fixture.textRecord(3, 3));
		expect(fixture.windows().nativeRange).toBe(false);

		// A keyboard authority write supersedes the record.
		await fixture.longPressWord();
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
		await fixture.longPressWord();
		expect(fixture.windows().nativeRange).toBe(true);
		fixture.editor.selectText(fixture.blockId, 2, 4);
		expect(fixture.windows().nativeRange).toBe(false);
		fixture.nativeRange(0, 9);
		expect(fixture.record()).toMatchObject(
			fixture.textRecord(2, 4, "programmatic"),
		);
	});

	it("R1: a fine-pointer selectstart opens no native-range window", async () => {
		const fixture = seedTouchField();
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
		const { editor, blockId, root, inline } = seedTextRoot();
		const text = inline().firstChild!;
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
		unsubscribe();
		reader.detach();
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

describe("gesture windows outlive a field session switch (R1–R3)", () => {
	it("R1: a press in block B keeps the pointer window open after the read that moves the session to B", async () => {
		const fixture = seedActiveField(TWO_BLOCKS);
		const blockB = fixture.blockIds[1]!;
		fixture.press("mouse", blockB);
		fixture.nativeRange(2, 2, blockB);
		expect(fixture.fieldEditor.focusBlockId).toBe(blockB);
		expect(fixture.windows().pointer).toBe(true);

		// The drag continues in B: its reads are accepted as pointer.
		fixture.nativeRange(2, 5, blockB);
		expect(fixture.record()).toMatchObject(
			fixture.textRecord(2, 5, "pointer", blockB),
		);
		await fixture.release();
		expect(fixture.windows().pointer).toBe(false);
	});

	it("R1: suspending the field for a pointer selection leaves the pointer window open", () => {
		const fixture = seedActiveField(TWO_BLOCKS);
		fixture.press("mouse", fixture.blockIds[1]);
		fixture.fieldEditor.suspendForPointerSelection();
		expect(fixture.fieldEditor.isEditing).toBe(false);
		expect(fixture.windows().pointer).toBe(true);
	});

	it("R1: a session switch binds no second document pointerup listener", async () => {
		const fixture = seedActiveField(TWO_BLOCKS);
		const blockB = fixture.blockIds[1]!;
		const pointerup = trackDocumentListeners("pointerup");
		fixture.press("mouse", blockB);
		fixture.fieldEditor.activate(blockB);
		fixture.press("mouse", blockB);
		expect(pointerup.added()).toBe(1);
		await fixture.release();
		expect(pointerup.live()).toBe(0);
	});

	it("C1: a deactivation mid-composition closes the ime window it owned", () => {
		const fixture = seedActiveField(TWO_BLOCKS);
		const blockB = fixture.blockIds[1]!;
		fixture.fieldEditor.reader.notifyGesture("compositionstart");
		fixture.press("mouse", blockB);
		fixture.fieldEditor.activate(blockB);
		expect(fixture.windows()).toMatchObject({ ime: false, pointer: true });
	});
});

describe("pointercancel ends the pointer gesture (R1, I4)", () => {
	it("R1: a document pointercancel closes the pointer window as pointerup does", async () => {
		const fixture = seedActiveField();
		fixture.press("touch");
		expect(fixture.windows().pointer).toBe(true);
		await fixture.release("pointercancel");
		expect(fixture.windows().pointer).toBe(false);

		// I4: a later read with every window closed does not write the record.
		const before = fixture.record();
		fixture.nativeRange(1, 4);
		expect(fixture.record()).toEqual(before);
	});

	it("R1: pointercancel and pointerup each end one gesture; the listener pair is released", async () => {
		const fixture = seedActiveField();
		const pointerup = trackDocumentListeners("pointerup");
		const pointercancel = trackDocumentListeners("pointercancel");
		fixture.press("touch");
		await fixture.release("pointercancel");
		expect(pointerup.live()).toBe(0);
		expect(pointercancel.live()).toBe(0);
		fixture.press("mouse");
		await fixture.release("pointerup");
		expect(pointerup.live()).toBe(0);
		expect(pointercancel.live()).toBe(0);
	});
});

describe("reader listener lifecycle", () => {
	it("R1: detach releases the document settle listener and closes the windows", () => {
		const fixture = seedActiveField();
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
		const fixture = seedActiveField();
		const pointerup = trackDocumentListeners("pointerup");
		const focusable = fixture.inline();
		focusable.tabIndex = 0;
		fixture.press("mouse");
		fixture.fieldEditor.destroy();
		expect(pointerup.live()).toBe(0);
		focusable.focus();
		const activate = vi.spyOn(fixture.fieldEditor, "activate");
		document.dispatchEvent(new PointerEvent("pointerup"));
		expect(activate).not.toHaveBeenCalled();
		expect(fixture.fieldEditor.isEditing).toBe(false);
	});
});
