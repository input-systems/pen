// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createEditor, getCommandRegistry } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { FieldEditorInputController } from "../controller";
import { ExpandedContentEditableBackend } from "../expandedContentEditableBackend";

type Activation = {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
};

function createFieldEditor(blockId: string) {
	const activations: Activation[] = [];
	let deactivated = 0;
	const controller = {
		focusBlockId: blockId,
		inputMode: "richtext" as const,
		activeCellCoord: null,
		activateCell: () => {},
		activateTextSelection: (
			targetBlockId: string,
			anchorOffset: number,
			focusOffset: number,
		) => {
			activations.push({
				blockId: targetBlockId,
				anchorOffset,
				focusOffset,
			});
		},
		deactivate: () => {
			deactivated += 1;
		},
		resetBackendSelectionAuthority: () => {},
		withBackendSelectionWrite: <T>(write: () => T) => write(),
		requestDomFocus: () => false,
		shouldHandleDomSelectionChange: () => false,
		getBackendSelectionApplicationDepth: () => 0,
		applyDomTextSelection: () => {},
		selectAllBehavior: "block-first" as const,
		resolveInsertMarks: () => undefined,
	};
	return { controller, activations, deactivated: () => deactivated };
}

function dispatchBeforeInput(host: HTMLElement, inputType: string): void {
	host.dispatchEvent(
		new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType,
		}),
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

describe("ExpandedContentEditableBackend handleBeforeInput enter", () => {
	it("activates the collapsed caret in-turn after a multi-block insertParagraph", () => {
		const editor = createEditor({ schema: defaultSchema });
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
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
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: secondBlockId,
				from: 0,
				to: 0,
				insert: "World",
			},
		]);
		editor.selectTextRange(
			{ blockId: firstBlockId, offset: 1 },
			{ blockId: secondBlockId, offset: 2 },
		);
		expect(editor.selection).toMatchObject({
			type: "text",
		});

		const fieldEditor = createFieldEditor(firstBlockId);
		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const dispatched: string[] = [];
		const originalDispatch = registry.dispatch.bind(registry);
		registry.dispatch = ((command, param, context) => {
			dispatched.push(command.name);
			return originalDispatch(command, param, context);
		}) as typeof registry.dispatch;

		const backend = new ExpandedContentEditableBackend(
			editor,
			fieldEditor.controller as unknown as FieldEditorInputController,
		);
		const host = document.createElement("div");
		backend.activate(host);

		const rafCallbacks: FrameRequestCallback[] = [];
		const originalRaf = globalThis.requestAnimationFrame;
		globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
			rafCallbacks.push(cb);
			return 1;
		}) as typeof requestAnimationFrame;

		try {
			dispatchBeforeInput(host, "insertParagraph");

			expect(dispatched).toEqual([]);
			expect(fieldEditor.deactivated()).toBe(1);
			expect(editor.getBlock(secondBlockId)).toBeNull();
			expect(editor.getBlock(firstBlockId)?.textContent()).toBe("H\nrld");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: firstBlockId, offset: 2 },
				focus: { blockId: firstBlockId, offset: 2 },
			});
			expect(fieldEditor.activations).toEqual([
				{
					blockId: firstBlockId,
					anchorOffset: 2,
					focusOffset: 2,
				},
			]);
			expect(rafCallbacks).toHaveLength(0);
		} finally {
			globalThis.requestAnimationFrame = originalRaf;
			backend.deactivate();
			editor.destroy();
		}
	});

	it("activates the split caret in-turn when applyEnterBehavior is the fallback", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 2, 2);

		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const dispatched: string[] = [];
		registry.dispatch = ((command) => {
			dispatched.push(command.name);
			return false;
		}) as typeof registry.dispatch;

		const fieldEditor = createFieldEditor(blockId);
		const backend = new ExpandedContentEditableBackend(
			editor,
			fieldEditor.controller as unknown as FieldEditorInputController,
		);
		const host = document.createElement("div");
		backend.activate(host);

		const rafCallbacks: FrameRequestCallback[] = [];
		const originalRaf = globalThis.requestAnimationFrame;
		globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
			rafCallbacks.push(cb);
			return 1;
		}) as typeof requestAnimationFrame;

		try {
			dispatchBeforeInput(host, "insertParagraph");

			expect(dispatched).toEqual(["pen.splitBlock"]);
			expect(fieldEditor.deactivated()).toBe(1);
			const blockIds = editor.documentState.blockOrder;
			expect(blockIds).toHaveLength(2);
			expect(editor.getBlock(blockId)?.textContent()).toBe("He");
			const newBlockId = blockIds[1];
			expect(newBlockId).toEqual(expect.any(String));
			expect(editor.getBlock(newBlockId!)?.textContent()).toBe("llo");
			expect(fieldEditor.activations).toEqual([
				{
					blockId: newBlockId,
					anchorOffset: 0,
					focusOffset: 0,
				},
			]);
			expect(rafCallbacks).toHaveLength(0);
		} finally {
			globalThis.requestAnimationFrame = originalRaf;
			backend.deactivate();
			editor.destroy();
		}
	});

	it("activates the split caret in-turn after a dispatched splitBlock", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 2, 2);

		const fieldEditor = createFieldEditor(blockId);
		const backend = new ExpandedContentEditableBackend(
			editor,
			fieldEditor.controller as unknown as FieldEditorInputController,
		);
		const host = document.createElement("div");
		backend.activate(host);

		try {
			dispatchBeforeInput(host, "insertParagraph");

			const blockIds = editor.documentState.blockOrder;
			expect(blockIds).toHaveLength(2);
			const newBlockId = blockIds[1];
			expect(fieldEditor.activations).toEqual([
				{
					blockId: newBlockId,
					anchorOffset: 0,
					focusOffset: 0,
				},
			]);
		} finally {
			backend.deactivate();
			editor.destroy();
		}
	});
});

describe("ExpandedContentEditableBackend keymap", () => {
	it("leaves multi-block Enter to beforeinput", () => {
		const editor = createEditor({ schema: defaultSchema });
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
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
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: secondBlockId,
				from: 0,
				to: 0,
				insert: "World",
			},
		]);
		editor.selectTextRange(
			{ blockId: firstBlockId, offset: 1 },
			{ blockId: secondBlockId, offset: 2 },
		);

		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const dispatched: string[] = [];
		const originalDispatch = registry.dispatch.bind(registry);
		registry.dispatch = ((command, param, context) => {
			dispatched.push(command.name);
			return originalDispatch(command, param, context);
		}) as typeof registry.dispatch;

		const fieldEditor = createFieldEditor(firstBlockId);
		const backend = new ExpandedContentEditableBackend(
			editor,
			fieldEditor.controller as unknown as FieldEditorInputController,
		);
		const host = document.createElement("div");
		backend.activate(host);

		try {
			const event = dispatchKeyDown(host, "Enter");

			expect(event.defaultPrevented).toBe(false);
			expect(dispatched).toEqual([]);
			expect(editor.getBlock(firstBlockId)?.textContent()).toBe("Hello");
			expect(editor.getBlock(secondBlockId)?.textContent()).toBe("World");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: firstBlockId, offset: 1 },
				focus: { blockId: secondBlockId, offset: 2 },
			});
		} finally {
			backend.deactivate();
			editor.destroy();
		}
	});

	it("installs the visual line-edge measure before dispatching Home", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 3, 3);

		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const lineEdgeSeam = Symbol.for("pen.lineEdgeSeam");
		const originalDispatch = registry.dispatch.bind(registry);
		registry.dispatch = ((command, param, context) => {
			if (command.name === "pen.caretLineStart") {
				expect(
					(editor as unknown as Record<symbol, unknown>)[
						lineEdgeSeam
					],
				).toEqual(expect.any(Function));
			}
			return originalDispatch(command, param, context);
		}) as typeof registry.dispatch;

		const fieldEditor = createFieldEditor(blockId);
		const backend = new ExpandedContentEditableBackend(
			editor,
			fieldEditor.controller as unknown as FieldEditorInputController,
		);
		const host = document.createElement("div");
		backend.activate(host);

		try {
			const event = dispatchKeyDown(host, "Home");

			expect(event.defaultPrevented).toBe(true);
			expect(editor.selection).toMatchObject({
				type: "text",
				focus: { blockId, offset: 0 },
			});
		} finally {
			backend.deactivate();
			editor.destroy();
		}
	});

	it("extends a backward word selection across another block", () => {
		const editor = createEditor({ schema: defaultSchema });
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const thirdBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "splice-text",
				blockId: firstBlockId,
				from: 0,
				to: 0,
				insert: "one",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "splice-text",
				blockId: secondBlockId,
				from: 0,
				to: 0,
				insert: "two",
			},
			{
				type: "insert-block",
				blockId: thirdBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: secondBlockId },
			},
			{
				type: "splice-text",
				blockId: thirdBlockId,
				from: 0,
				to: 0,
				insert: "three",
			},
		]);
		editor.selectTextRange(
			{ blockId: thirdBlockId, offset: 0 },
			{ blockId: secondBlockId, offset: 0 },
		);

		const fieldEditor = createFieldEditor(secondBlockId);
		const backend = new ExpandedContentEditableBackend(
			editor,
			fieldEditor.controller as unknown as FieldEditorInputController,
		);
		const host = document.createElement("div");
		backend.activate(host);

		const previousPlatform = navigator.platform;
		Object.defineProperty(navigator, "platform", {
			configurable: true,
			value: "MacIntel",
		});
		try {
			const event = dispatchKeyDown(host, "ArrowLeft", {
				altKey: true,
				shiftKey: true,
			});

			expect(event.defaultPrevented).toBe(true);
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: thirdBlockId, offset: 0 },
				focus: { blockId: firstBlockId, offset: 3 },
			});
		} finally {
			Object.defineProperty(navigator, "platform", {
				configurable: true,
				value: previousPlatform,
			});
			backend.deactivate();
			editor.destroy();
		}
	});
});
