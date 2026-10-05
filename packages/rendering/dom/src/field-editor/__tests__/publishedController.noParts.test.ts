// @vitest-environment jsdom

import {
	createDecorationSet,
	createEditor,
	decorationsFacet,
	defineExtension,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import type { Editor } from "@input/pen-types";
import { ContentEditableBackend } from "../contenteditableBackend";
import { DIRECT_HANDLERS } from "../contenteditableDirectHandlers";
import type {
	FieldEditorInputController,
	FieldEditorSession,
} from "../controller";
import type { FieldEditorTextLike } from "../crdt";
import { EditContextBackend } from "../editContextBackend";
import type { EditContext } from "../editContextTypes";
import { attachContentGestures } from "../contentGestures";
import { applyInlineTextDiffInput } from "../textInputPipeline";
import type { InputBackend } from "../../internal/inputBackend";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { RegionSelectionStore } from "../../utils/regionSelection";

/**
 * The published `FieldEditorInputController` and `FieldEditorSession` strip
 * pen-dom's own parts (`reader`, `projector`, `pendingMarks` are
 * `@internal`), so a host-built controller that type-checks against the
 * published types has none of them. Backends and content gestures fall back
 * to the defaults they had before the parts existed: no gesture
 * notification, marks inherited from the insert position, and a projection
 * after a decoration rebuild.
 */

const TEXT = "Hello world";
const DECORATION_ATTRIBUTE = "data-test-decorated";

class RecordingEditContext implements EditContext {
	text = "";
	selectionStart = 0;
	selectionEnd = 0;
	private readonly listeners = new Map<string, Set<(event: Event) => void>>();
	updateText(start: number, end: number, text: string): void {
		this.text = `${this.text.slice(0, start)}${text}${this.text.slice(end)}`;
	}
	updateSelection(start: number, end: number): void {
		this.selectionStart = start;
		this.selectionEnd = end;
	}
	updateCharacterBounds(): void {}
	addEventListener(type: string, handler: (event: Event) => void): void {
		const handlers = this.listeners.get(type) ?? new Set();
		handlers.add(handler);
		this.listeners.set(type, handlers);
	}
	removeEventListener(type: string, handler: (event: Event) => void): void {
		this.listeners.get(type)?.delete(handler);
	}
	emit(type: string, init: Record<string, unknown> = {}): void {
		const event = Object.assign(new Event(type), init);
		for (const handler of this.listeners.get(type) ?? []) {
			handler(event);
		}
	}
}

function getYText(editor: Editor, blockId: string): FieldEditorTextLike {
	const ydoc = editor.internals.adapter.raw<{
		getMap(name: string): {
			get(key: string): { get(field: string): unknown } | undefined;
		};
	}>(editor.internals.crdtDoc);
	const ytext = ydoc.getMap("blocks").get(blockId)?.get("content") as
		FieldEditorTextLike | null | undefined;
	if (!ytext) {
		throw new Error(`Missing test Y.Text for block ${blockId}`);
	}
	return ytext;
}

function seedEditor() {
	let decorated = false;
	const editor = createEditor({
		schema: defaultSchema,
		extensions: [
			defineExtension({
				name: "test-decorations",
				facets: [
					decorationsFacet.of((_state, currentEditor) => {
						const firstBlockId = currentEditor.firstBlock()?.id;
						if (!decorated || !firstBlockId) {
							return createDecorationSet([]);
						}
						return createDecorationSet([
							{
								type: "inline",
								blockId: firstBlockId,
								from: 0,
								to: 5,
								attributes: { [DECORATION_ATTRIBUTE]: "" },
							},
						]);
					}),
				],
			}),
		],
	});
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: TEXT },
		{
			type: "format-text",
			blockId,
			from: 0,
			to: TEXT.length,
			marks: { bold: true },
		},
	]);
	editor.selectText(blockId, TEXT.length, TEXT.length);
	return {
		editor,
		blockId,
		decorate: () => {
			decorated = true;
			editor.requestDecorationUpdate();
		},
	};
}

function mountRoot(blockId: string): {
	root: HTMLElement;
	inline: HTMLElement;
} {
	const root = document.createElement("div");
	root.setAttribute(DATA_ATTRS.editorRoot, "");
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = TEXT;
	block.append(inline);
	root.append(block);
	document.body.append(root);
	return { root, inline };
}

/** Only the members the published controller type keeps; no pen-dom parts. */
function partlessController(
	editor: Editor,
	blockId: string,
): FieldEditorInputController {
	return {
		get selection() {
			return editor.selection;
		},
		focusBlockId: blockId,
		inputMode: "richtext",
		activeCellCoord: null,
		isEditing: true,
		isComposing: false,
		selectAllBehavior: "block-first",
		activateCell: () => {},
		activateTextSelection: () => {},
		commitProgrammaticTextSelection: () => {},
		deactivate: () => {},
		requestDomFocus: () => false,
		requestRootFocus: () => false,
		applyDocumentTextSelection: () => {},
		applyDomTextSelection: () => {},
		syncTextSelection: (id, anchor, focus) =>
			editor.selectText(id, anchor, focus),
		syncCellTextSelection: () => {},
		setComposing: () => {},
		notifyDomReconciled: () => {},
	};
}

const fixtures: Array<{ editor: Editor; backend?: InputBackend; detach?: () => void }> = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.detach?.();
		fixture.backend?.deactivate();
		fixture.editor.destroy();
	}
	document.body.replaceChildren();
	delete (globalThis as { EditContext?: unknown }).EditContext;
});

describe("FieldEditorParts: a host-built controller without pen-dom's parts", () => {
	it("drives the contenteditable backend through composition, gestures and a decoration change", () => {
		const { editor, blockId, decorate } = seedEditor();
		const { inline } = mountRoot(blockId);
		const backend = new ContentEditableBackend(
			editor,
			partlessController(editor, blockId),
		);
		fixtures.push({ editor, backend });

		expect(() => {
			backend.activate(inline, getYText(editor, blockId));
			inline.dispatchEvent(new Event("pointerdown", { bubbles: true }));
			inline.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
			inline.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
			document.dispatchEvent(new Event("dragend"));
			inline.dispatchEvent(new Event("compositionstart", { bubbles: true }));
			inline.dispatchEvent(new Event("compositionend", { bubbles: true }));
			decorate();
		}).not.toThrow();
		expect(inline.querySelector(`[${DECORATION_ATTRIBUTE}]`)).not.toBeNull();
	});

	it("inserts typed text with the marks at the insert position", () => {
		const { editor, blockId } = seedEditor();
		const controller = partlessController(editor, blockId);
		fixtures.push({ editor });

		DIRECT_HANDLERS.insertText(
			{ inputType: "insertText", data: "!" } as InputEvent,
			editor,
			getYText(editor, blockId),
			controller,
			{} as HTMLElement,
			{
				resolveCurrentInputRange: () => ({
					start: TEXT.length,
					end: TEXT.length,
				}),
				applyListInputRule: () => false,
				applyInlineTextEdit: () => {},
			},
		);
		applyInlineTextDiffInput({
			editor,
			fieldEditor: controller,
			blockId,
			ytext: getYText(editor, blockId),
			diff: [{ type: "insert", offset: TEXT.length + 1, text: "?" }],
		});

		const block = editor.getBlock(blockId)!;
		expect(block.textContent()).toBe(`${TEXT}!?`);
		const deltas = block.inlineDeltas();
		expect(deltas).toHaveLength(1);
		expect(deltas[0]?.attributes).toMatchObject({ bold: true });
	});

	it("drives the EditContext backend through composition, typing and a decoration change", () => {
		(globalThis as { EditContext?: unknown }).EditContext =
			RecordingEditContext;
		const { editor, blockId, decorate } = seedEditor();
		const { inline } = mountRoot(blockId);
		const backend = new EditContextBackend(
			editor,
			partlessController(editor, blockId),
		);
		fixtures.push({ editor, backend });
		backend.activate(inline, getYText(editor, blockId));
		const editContext = (
			inline as HTMLElement & { editContext?: RecordingEditContext }
		).editContext!;

		expect(() => {
			inline.dispatchEvent(new Event("pointerdown", { bubbles: true }));
			editContext.emit("textupdate", {
				text: "!",
				updateRangeStart: TEXT.length,
				updateRangeEnd: TEXT.length,
				selectionStart: TEXT.length + 1,
				selectionEnd: TEXT.length + 1,
			});
			editContext.emit("compositionstart");
			editContext.emit("compositionend", { data: "" });
			decorate();
		}).not.toThrow();
		expect(editor.getBlock(blockId)?.textContent()).toBe(`${TEXT}!`);
		expect(inline.querySelector(`[${DECORATION_ATTRIBUTE}]`)).not.toBeNull();
	});

	it("attaches content gestures and runs a click without the reader", () => {
		const { editor, blockId } = seedEditor();
		const { root, inline } = mountRoot(blockId);
		const content = inline.parentElement!.parentElement!;
		const session = partlessController(
			editor,
			blockId,
		) as unknown as FieldEditorSession;
		const detach = attachContentGestures({
			editor,
			fieldEditor: session,
			contentElement: content,
			getBlocksHost: () => root,
			regionSelectionStore: new RegionSelectionStore(),
			state: {
				regionGesture: { current: null },
				pointerGesture: { current: null },
				pointerGestureVersion: { current: 0 },
				interactionModel: {
					current: {} as never,
				},
				clearPointerSelectionState: () => {},
			},
			blockSelectionEnabled: false,
		});
		fixtures.push({ editor, detach });

		expect(() => {
			inline.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true, button: 0 }),
			);
			document.dispatchEvent(
				new MouseEvent("mouseup", { bubbles: true, button: 0 }),
			);
			detach();
		}).not.toThrow();
	});
});
