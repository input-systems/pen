// @vitest-environment jsdom

import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DiagnosticEvent, InlineInsert } from "@input/pen-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldEditorFocusRequest, FieldEditorTableNavigationController } from "../field-editor/controller";
import { attachContentGestures } from "../field-editor/contentGestures";
import { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { isInlineAtomChipNode } from "../field-editor/inlineAtomDom";
import { mountEditor } from "../host/mountEditor";
import { DATA_ATTRS } from "../utils/dataAttributes";
import type { PointerSelectionGesture } from "../utils/pointerSelection";
import { RegionSelectionStore } from "../utils/regionSelection";
import { handleTableCellSelectionKeyDown } from "../utils/tableCellNavigation";

const cleanups: Array<() => void> = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	document.body.replaceChildren();
});

/**
 * An iframe's document. Nodes created in it belong to the iframe's realm, so
 * the host window's `Node`/`Element` constructors do not recognise them.
 */
function createFrame() {
	const iframe = document.createElement("iframe");
	document.body.append(iframe);
	return { frameDocument: iframe.contentDocument!, frameWindow: iframe.contentWindow as Window & typeof globalThis };
}

function createFrameEditor() {
	const editor = createEditor({ schema: defaultSchema });
	cleanups.push(() => editor.destroy());
	return editor;
}

function mountInIframe(content: InlineInsert[] = ["Hello world"]) {
	const { frameDocument, frameWindow } = createFrame();
	const editor = createFrameEditor();
	const blockId = editor.firstBlock()!.id;
	editor.apply([{ type: "splice-text", blockId, from: 0, to: 0, insert: content }]);
	const root = frameDocument.createElement("div");
	const input = frameDocument.createElement("input");
	frameDocument.body.append(root, input);
	const focusRequests: FieldEditorFocusRequest[] = [];
	const diagnostics: DiagnosticEvent[] = [];
	editor.on("diagnostic", (event) => diagnostics.push(event));
	const mounted = mountEditor(editor, root, {
		focusPolicy: {
			decide: (request) => {
				focusRequests.push(request);
				return { type: "allow" };
			},
		},
	});
	cleanups.unshift(() => mounted.destroy());
	const inline = root.querySelector<HTMLElement>(`[${DATA_ATTRS.inlineContent}]`)!;
	return { editor, blockId, root, inline, input, mounted, frameDocument, frameWindow, focusRequests, diagnostics };
}

function keydown(frameWindow: Window & typeof globalThis, key: string): KeyboardEvent {
	return new frameWindow.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
}

describe("an editor mounted in an iframe document", () => {
	it("HOST9: a native input in the iframe keeps focus against an authority write", () => {
		const { editor, blockId, root, input, mounted, frameDocument, frameWindow, focusRequests } = mountInIframe();
		// The fixture's premise: its nodes are not the host window's.
		expect(root instanceof HTMLElement).toBe(false);
		expect(root instanceof frameWindow.HTMLElement).toBe(true);
		mounted.fieldEditor.activateTextSelection(blockId, 0, 5);
		input.focus();
		expect(frameDocument.activeElement).toBe(input);
		focusRequests.length = 0;

		editor.selectText(blockId, 2, 4);

		expect(focusRequests).toEqual([]);
		expect(frameDocument.activeElement).toBe(input);
	});

	it("P3: a rebuild does not write while a native input in the iframe owns focus", () => {
		const { blockId, input, mounted } = mountInIframe();
		mounted.fieldEditor.activateTextSelection(blockId, 0, 5);
		input.focus();

		expect(mounted.fieldEditor.projector.shouldProjectSelectionAfterReconcile()).toBe(false);
	});

	it("P: a projection with focus on its target reads back as focused, so no mismatch is reported", () => {
		const { editor, blockId, mounted, diagnostics } = mountInIframe();
		mounted.fieldEditor.activateTextSelection(blockId, 0, 5);

		editor.selectText(blockId, 2, 4, { origin: "keyboard" });

		expect(diagnostics.filter((event) => event.code === "selection-projection-mismatch")).toEqual([]);
	});

	it("R1: a pointerdown on the field inside the iframe opens the pointer window", () => {
		const { inline, mounted, frameWindow } = mountInIframe();

		inline.dispatchEvent(new frameWindow.Event("pointerdown", { bubbles: true }));

		expect(mounted.fieldEditor.reader.windows.pointer).toBe(true);
	});

	it("O1: a click on an inline atom chip in the iframe activates its block", () => {
		const { blockId, root, mounted, frameWindow } = mountInIframe([
			"Hi ",
			{ nodeType: "mention", props: { id: "1", label: "Ada" } },
			" there",
		]);
		const chip = root.querySelector(`[${DATA_ATTRS.inlineAtom}]`);
		expect(isInlineAtomChipNode(chip)).toBe(true);

		chip!.dispatchEvent(new frameWindow.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));

		expect(mounted.fieldEditor.getSnapshot()).toMatchObject({ isEditing: true, focusBlockId: blockId });
	});

	it("T: arrow keys in a native input inside the active table cell in the iframe stay the input's", () => {
		const { frameDocument, frameWindow } = createFrame();
		const editor = createFrameEditor();
		editor.apply([{ type: "insert-block", blockId: "t1", blockType: "table", props: {}, position: "last" }]);
		editor.selectCell("t1", 0, 0);
		const table = frameDocument.createElement("div");
		table.setAttribute(DATA_ATTRS.blockId, "t1");
		const cell = frameDocument.createElement("div");
		cell.setAttribute("data-cell-row", "0");
		cell.setAttribute("data-cell-col", "0");
		const input = frameDocument.createElement("input");
		cell.append(input);
		table.append(cell);
		frameDocument.body.append(table);
		const fieldEditor = { isEditing: false, deactivate: vi.fn() } as unknown as FieldEditorTableNavigationController;
		let handled: boolean | null = null;
		input.addEventListener("keydown", (event) => {
			handled = handleTableCellSelectionKeyDown({ event, editor, fieldEditor, root: table });
		});

		input.dispatchEvent(keydown(frameWindow, "ArrowRight"));

		expect(handled).toBe(false);
		const selection = editor.selection;
		expect(selection?.type === "cell" ? selection.head : null).toEqual({ row: 0, col: 0 });
	});
});

/**
 * Two paragraphs mounted by hand in an iframe, with a bare `FieldEditorImpl`
 * and the content gestures React attaches (`attachContentGestures`), so only
 * those gestures handle the pointer (vanilla's host activation is absent).
 */
function mountGesturesInIframe() {
	const { frameDocument, frameWindow } = createFrame();
	const editor = createFrameEditor();
	const first = editor.firstBlock()!.id;
	const second = "second";
	const texts = [
		[first, "Hello world"],
		[second, "Second line"],
	] as const;
	editor.apply([
		{ type: "insert-block", blockId: second, blockType: "paragraph", props: {}, position: { after: first } },
		...texts.map(([blockId, insert]) => ({ type: "splice-text" as const, blockId, from: 0, to: 0, insert })),
	]);
	const element = (attribute: string, value = "") => {
		const node = frameDocument.createElement("div");
		node.setAttribute(attribute, value);
		return node;
	};
	const root = element(DATA_ATTRS.editorRoot);
	const content = element(DATA_ATTRS.editorContent);
	const blocksHost = element(DATA_ATTRS.editorBlocksHost);
	const inlines = new Map<string, HTMLElement>();
	for (const [blockId, text] of texts) {
		const block = element(DATA_ATTRS.editorBlock);
		block.setAttribute(DATA_ATTRS.blockId, blockId);
		const inline = element(DATA_ATTRS.inlineContent);
		inline.textContent = text;
		block.append(inline);
		blocksHost.append(block);
		inlines.set(blockId, inline);
	}
	content.append(blocksHost);
	root.append(content);
	frameDocument.body.append(root);
	const fieldEditor = new FieldEditorImpl(editor);
	fieldEditor.setRootElement(root);
	const state = {
		regionGesture: { current: null },
		pointerGesture: { current: null as PointerSelectionGesture | null },
		pointerGestureVersion: { current: 0 },
		interactionModel: { current: { clickToSelect: false } },
		clearPointerSelectionState: () => {
			state.pointerGesture.current = null;
		},
	};
	const detach = attachContentGestures({
		editor,
		fieldEditor,
		contentElement: content,
		getBlocksHost: () => blocksHost,
		regionSelectionStore: new RegionSelectionStore(),
		state,
		blockSelectionEnabled: true,
	});
	cleanups.unshift(() => {
		detach();
		fieldEditor.destroy();
	});
	const mouse = (type: "mousedown" | "mouseup" | "click", target: EventTarget, shiftKey = false) =>
		target.dispatchEvent(
			new frameWindow.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, detail: 1, shiftKey }),
		);
	return { editor, fieldEditor, first, second, inlines, state, mouse };
}

describe("React content gestures over an editor in an iframe document", () => {
	it("T2: a press on a block in the iframe starts a pointer gesture on that block", () => {
		const { second, inlines, state, mouse } = mountGesturesInIframe();

		mouse("mousedown", inlines.get(second)!);

		expect(state.pointerGesture.current?.blockId).toBe(second);
	});

	it("T5: a shift-click on another block in the iframe extends the caret into it", () => {
		const { editor, fieldEditor, first, second, inlines, mouse } = mountGesturesInIframe();
		fieldEditor.activateTextSelection(first, 2, 2, { origin: "pointer" });
		const target = inlines.get(second)!;

		mouse("mousedown", target, true);
		mouse("mouseup", target, true);
		mouse("click", target, true);

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: first, offset: 2 },
			focus: { blockId: second },
		});
	});
});

type LineEdgeMeasure = (
	editor: unknown,
	current: { blockId: string; offset: number },
	edge: "start" | "end",
) => unknown;

describe("field input in an iframe document", () => {
	it("M3: the line-edge measure a key installs looks the block up in the iframe's document", () => {
		const { editor, blockId, inline, mounted, frameDocument, frameWindow } = mountInIframe();
		mounted.fieldEditor.activateTextSelection(blockId, 5, 5);
		inline.dispatchEvent(keydown(frameWindow, "ArrowLeft"));
		const measure = (editor as unknown as Record<symbol, LineEdgeMeasure | undefined>)[
			Symbol.for("pen.lineEdgeSeam")
		];
		expect(measure, "a field key installs the measure").toBeTypeOf("function");
		const query = vi.spyOn(frameDocument, "querySelector");

		measure!(editor, { blockId, offset: 5 }, "start");

		expect(
			query.mock.calls.some(([selector]) => selector.includes(`${DATA_ATTRS.blockId}="${blockId}"`)),
		).toBe(true);
	});

	it("C1: an EditContext compositionend from the iframe's realm commits its data", () => {
		const listeners = new Map<string, Set<(event: Event) => void>>();
		class RealmEditContext {
			text = "";
			selectionStart = 0;
			selectionEnd = 0;
			updateText(start: number, end: number, text: string): void {
				this.text = `${this.text.slice(0, start)}${text}${this.text.slice(end)}`;
			}
			updateSelection(start: number, end: number): void {
				this.selectionStart = start;
				this.selectionEnd = end;
			}
			updateCharacterBounds(): void {}
			addEventListener(type: string, handler: (event: Event) => void): void {
				const handlers = listeners.get(type) ?? new Set();
				handlers.add(handler);
				listeners.set(type, handlers);
			}
			removeEventListener(type: string, handler: (event: Event) => void): void {
				listeners.get(type)?.delete(handler);
			}
		}
		const emit = (type: string, init: Record<string, unknown>) => {
			const event = Object.assign(new Event(type), init);
			for (const handler of listeners.get(type) ?? []) handler(event);
		};
		(globalThis as { EditContext?: unknown }).EditContext = RealmEditContext;
		cleanups.push(() => {
			delete (globalThis as { EditContext?: unknown }).EditContext;
		});
		const { editor, blockId, inline, mounted, frameWindow } = mountInIframe();
		mounted.fieldEditor.activateTextSelection(blockId, 11, 11);

		emit("textupdate", {
			text: "nihao",
			updateRangeStart: 11,
			updateRangeEnd: 11,
			selectionStart: 16,
			selectionEnd: 16,
		});
		emit("textformatupdate", { getTextFormats: () => [] });
		inline.dispatchEvent(new frameWindow.CompositionEvent("compositionend", { bubbles: true, data: "nihao" }));

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello worldnihao");
	});
});
