// @vitest-environment jsdom

import {
	createDecorationSet,
	createEditor,
	decorationsFacet,
	defineExtension,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@input/pen-types";
import { ContentEditableBackend } from "../contenteditableBackend";
import type { FieldEditorInputController } from "../controller";
import type { FieldEditorTextLike } from "../crdt";
import { EditContextBackend } from "../editContextBackend";
import type { EditContext } from "../editContextTypes";
import type { InputBackend } from "../../internal/inputBackend";
import { DATA_ATTRS } from "../../utils/dataAttributes";

const TEXT = "Hello world";
const DECORATION_ATTRIBUTE = "data-test-decorated";

class FakeEditContext implements EditContext {
	text = "";
	selectionStart = 0;
	selectionEnd = 0;
	updateText(): void {}
	updateSelection(): void {}
	updateCharacterBounds(): void {}
	addEventListener(): void {}
	removeEventListener(): void {}
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

/** An editor whose first block carries one inline decoration once `decorate()` is called. */
function seedEditor(): {
	editor: Editor;
	blockId: string;
	decorate: () => void;
} {
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
	]);
	editor.setSelection({
		type: "text",
		anchor: { blockId, offset: 0 },
		focus: { blockId, offset: 5 },
	});
	return {
		editor,
		blockId,
		decorate: () => {
			decorated = true;
			editor.requestDecorationUpdate();
		},
	};
}

function inlineElement(blockId: string): HTMLElement {
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
	return inline;
}

function stubController(
	editor: Editor,
	blockId: string,
	shouldProjectSelectionAfterReconcile: boolean,
) {
	const withBackendSelectionWrite = vi.fn(<T>(write: () => T) => write());
	const controller = {
		focusBlockId: blockId,
		inputMode: "richtext" as const,
		activeCellCoord: null,
		get selection() {
			return editor.selection;
		},
		activateCell: () => {},
		activateTextSelection: () => {},
		deactivate: () => {},
		resetBackendSelectionAuthority: () => {},
		withBackendSelectionWrite,
		requestDomFocus: () => false,
		shouldHandleDomSelectionChange: () => false,
		shouldProjectSelectionAfterReconcile: () =>
			shouldProjectSelectionAfterReconcile,
		getBackendSelectionApplicationDepth: () => 0,
		applyDomTextSelection: () => {},
		selectAllBehavior: "block-first" as const,
		resolveInsertMarks: () => undefined,
		setComposing: () => {},
		notifyDomReconciled: () => {},
		notifyGestureEvent: () => {},
		setBackendSelectionAuthority: () => {},
		getBackendSelectionAuthority: () => null,
		hasBackendSelectionAuthority: () => false,
		clearBackendSelectionAuthority: () => {},
		setEditContextSelectionSnapshot: () => {},
		getEditContextSelectionSnapshot: () => null,
	} as unknown as FieldEditorInputController;
	return { controller, withBackendSelectionWrite };
}

type Fixture = { editor: Editor; backend: InputBackend };
const fixtures: Fixture[] = [];

function mount(
	createBackend: (
		editor: Editor,
		controller: FieldEditorInputController,
	) => InputBackend,
	shouldProjectSelectionAfterReconcile: boolean,
) {
	const { editor, blockId, decorate } = seedEditor();
	const element = inlineElement(blockId);
	const { controller, withBackendSelectionWrite } = stubController(
		editor,
		blockId,
		shouldProjectSelectionAfterReconcile,
	);
	const backend = createBackend(editor, controller);
	fixtures.push({ editor, backend });
	backend.activate(element, getYText(editor, blockId));
	withBackendSelectionWrite.mockClear();
	return { element, decorate, withBackendSelectionWrite };
}

const backends = [
	{
		name: "contenteditable",
		create: (editor: Editor, controller: FieldEditorInputController) =>
			new ContentEditableBackend(editor, controller),
	},
	{
		name: "EditContext",
		create: (editor: Editor, controller: FieldEditorInputController) => {
			(globalThis as { EditContext?: unknown }).EditContext =
				FakeEditContext;
			return new EditContextBackend(editor, controller);
		},
	},
];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.backend.deactivate();
		fixture.editor.destroy();
	}
	document.body.replaceChildren();
	delete (globalThis as { EditContext?: unknown }).EditContext;
});

describe.each(backends)(
	"HOST9: $name decoration change while another control owns focus",
	({ create }) => {
		it("rebuilds the field without writing the selection back into the DOM", () => {
			const { element, decorate, withBackendSelectionWrite } = mount(
				create,
				false,
			);

			decorate();

			expect(
				element.querySelector(`[${DECORATION_ATTRIBUTE}]`),
			).not.toBeNull();
			expect(withBackendSelectionWrite).not.toHaveBeenCalled();
		});

		it("still restores the selection when the field owns focus", () => {
			const { element, decorate, withBackendSelectionWrite } = mount(
				create,
				true,
			);

			decorate();

			expect(
				element.querySelector(`[${DECORATION_ATTRIBUTE}]`),
			).not.toBeNull();
			expect(withBackendSelectionWrite).toHaveBeenCalled();
		});
	},
);
