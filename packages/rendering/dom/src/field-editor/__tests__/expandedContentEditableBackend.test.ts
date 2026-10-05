// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { getCommandRegistry } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import type { FieldEditorInputController } from "../controller";
import { ExpandedContentEditableBackend } from "../expandedContentEditableBackend";
import { stubFieldEditorParts } from "./fieldEditorParts.testHelpers";
import {
	recordingController,
	seedParagraphs,
	spyDispatch,
	withPlatform,
} from "./fieldEditorFixtures.testHelpers";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.unstubAllGlobals();
});

/** Paragraphs holding `texts`, with the expanded backend attached to a host. */
function mountExpanded(
	texts: readonly string[],
	select: (editor: Editor, blockIds: string[]) => void,
	wrap: (controller: FieldEditorInputController) => FieldEditorInputController = (
		controller,
	) => controller,
) {
	const { editor, blockIds } = seedParagraphs(texts);
	select(editor, blockIds);
	const recording = recordingController(blockIds[0]!, { commit: false });
	const backend = new ExpandedContentEditableBackend(editor, wrap(recording.controller));
	const host = document.createElement("div");
	backend.activate(host);
	cleanups.push(() => {
		backend.deactivate();
		editor.destroy();
	});
	return { editor, blockIds, backend, host, recording };
}

function dispatchBeforeInput(host: HTMLElement, inputType: string): void {
	host.dispatchEvent(
		new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType }),
	);
}

function dispatchKeyDown(
	host: HTMLElement,
	key: string,
	options: KeyboardEventInit = {},
): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...options,
	});
	host.dispatchEvent(event);
	return event;
}

/** "Hello" / "World" selected from offset 1 of the first to 2 of the second. */
function selectAcross(editor: Editor, [first, second]: string[]): void {
	editor.selectTextRange({ blockId: first!, offset: 1 }, { blockId: second!, offset: 2 });
}

function caretAt(offset: number) {
	return (editor: Editor, [blockId]: string[]) => editor.selectText(blockId!, offset, offset);
}

/** Records frames instead of running them, to prove the activation is in-turn. */
function stubFrames(): FrameRequestCallback[] {
	const frames: FrameRequestCallback[] = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return 1;
	});
	return frames;
}

describe("ExpandedContentEditableBackend handleBeforeInput enter", () => {
	it("activates the collapsed caret in-turn after a multi-block insertParagraph", () => {
		const { editor, blockIds, host, recording } = mountExpanded(["Hello", "World"], selectAcross);
		const [firstBlockId, secondBlockId] = blockIds;
		const dispatched = spyDispatch(editor);
		const frames = stubFrames();

		dispatchBeforeInput(host, "insertParagraph");

		expect(dispatched).toEqual([]);
		expect(recording.deactivated()).toBe(1);
		expect(editor.getBlock(secondBlockId!)).toBeNull();
		expect(editor.getBlock(firstBlockId!)?.textContent()).toBe("H\nrld");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 2 },
			focus: { blockId: firstBlockId, offset: 2 },
		});
		expect(recording.activations).toEqual([
			{ blockId: firstBlockId, anchorOffset: 2, focusOffset: 2, kind: "activate" },
		]);
		expect(frames).toHaveLength(0);
	});

	it.each([
		["applyEnterBehavior is the fallback", true],
		["a dispatched splitBlock", false],
	])("activates the split caret in-turn after %s", (_name, declineDispatch) => {
		const { editor, blockIds, host, recording } = mountExpanded(["Hello"], caretAt(2));
		const dispatched: string[] = [];
		if (declineDispatch) {
			const registry = getCommandRegistry(editor)!;
			registry.dispatch = ((command) => {
				dispatched.push(command.name);
				return false;
			}) as typeof registry.dispatch;
		}
		const frames = stubFrames();

		dispatchBeforeInput(host, "insertParagraph");

		const order = editor.documentState.blockOrder;
		expect(order).toHaveLength(2);
		expect(editor.getBlock(blockIds[0]!)?.textContent()).toBe("He");
		expect(editor.getBlock(order[1]!)?.textContent()).toBe("llo");
		expect(recording.deactivated()).toBe(1);
		expect(recording.activations).toEqual([
			{ blockId: order[1], anchorOffset: 0, focusOffset: 0, kind: "activate" },
		]);
		expect(dispatched).toEqual(declineDispatch ? ["pen.splitBlock"] : []);
		expect(frames).toHaveLength(0);
	});
});

describe("ExpandedContentEditableBackend keymap", () => {
	it("leaves multi-block Enter to beforeinput", () => {
		const { editor, blockIds, host } = mountExpanded(["Hello", "World"], selectAcross);
		const [firstBlockId, secondBlockId] = blockIds;
		const dispatched = spyDispatch(editor);

		const event = dispatchKeyDown(host, "Enter");

		expect(event.defaultPrevented).toBe(false);
		expect(dispatched).toEqual([]);
		expect(editor.getBlock(firstBlockId!)?.textContent()).toBe("Hello");
		expect(editor.getBlock(secondBlockId!)?.textContent()).toBe("World");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});
	});

	it("installs the visual line-edge measure before dispatching Home", () => {
		const { editor, blockIds, host } = mountExpanded(["Hello"], caretAt(3));
		const registry = getCommandRegistry(editor)!;
		const lineEdgeSeam = Symbol.for("pen.lineEdgeSeam");
		const originalDispatch = registry.dispatch.bind(registry);
		registry.dispatch = ((command, param, context) => {
			if (command.name === "pen.caretLineStart") {
				expect((editor as unknown as Record<symbol, unknown>)[lineEdgeSeam]).toEqual(
					expect.any(Function),
				);
			}
			return originalDispatch(command, param, context);
		}) as typeof registry.dispatch;

		const event = dispatchKeyDown(host, "Home");

		expect(event.defaultPrevented).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId: blockIds[0], offset: 0 },
		});
	});

	it("extends a backward word selection across another block", () => {
		const { editor, blockIds, host } = mountExpanded(
			["one", "two", "three"],
			(editor, [, second, third]) =>
				editor.selectTextRange({ blockId: third!, offset: 0 }, { blockId: second!, offset: 0 }),
		);

		const event = withPlatform("MacIntel", () =>
			dispatchKeyDown(host, "ArrowLeft", { altKey: true, shiftKey: true }),
		);

		expect(event.defaultPrevented).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: blockIds[2], offset: 0 },
			focus: { blockId: blockIds[0], offset: 3 },
		});
	});
});

describe("ExpandedContentEditableBackend composition window", () => {
	function mountComposing() {
		const composing: boolean[] = [];
		const gestures: string[] = [];
		const fixture = mountExpanded(["Hello", "World"], selectAcross, (controller) => ({
			...controller,
			setComposing: (value: boolean) => composing.push(value),
			...stubFieldEditorParts({ onGesture: (kind) => gestures.push(kind) }),
		}) as unknown as FieldEditorInputController);
		return { ...fixture, composing, gestures };
	}

	const compose = (host: HTMLElement, type: "compositionstart" | "compositionend") =>
		host.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: "x" }));

	it("C1: a composition in the host opens and closes the ime window", () => {
		const { editor, blockIds, host, composing, gestures } = mountComposing();

		compose(host, "compositionstart");
		expect(composing).toEqual([true]);
		expect(gestures).toEqual(["compositionstart"]);
		compose(host, "compositionend");
		expect(composing).toEqual([true, false]);
		expect(gestures).toEqual(["compositionstart", "compositionend-completed"]);
		expect(editor.getBlock(blockIds[0]!)?.textContent()).toBe("Hxrld");
	});

	it("FE2: a composition does not survive a re-attach of the same instance", () => {
		const { editor, blockIds, backend, host, composing } = mountComposing();

		compose(host, "compositionstart");
		backend.deactivate();
		expect(composing).toEqual([true, false]);
		backend.activate(host);
		compose(host, "compositionend");

		expect(editor.getBlock(blockIds[0]!)?.textContent()).toBe("Hello");
		expect(composing).toEqual([true, false]);
	});
});
