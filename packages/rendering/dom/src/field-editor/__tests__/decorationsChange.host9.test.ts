// @vitest-environment jsdom

import {
	createDecorationSet,
	createEditor,
	decorationsFacet,
	defineExtension,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HISTORY_ORIGIN_TAG, type Editor } from "@input/pen-types";
import { ContentEditableBackend } from "../contenteditableBackend";
import type { FieldEditorInputController } from "../controller";
import type { FieldEditorTextLike } from "../crdt";
import { EditContextBackend } from "../editContextBackend";
import type { EditContext } from "../editContextTypes";
import type { InputBackend } from "../../internal/inputBackend";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { stubFieldEditorParts } from "./fieldEditorParts.testHelpers";

const TEXT = "Hello world";
const DECORATION_ATTRIBUTE = "data-test-decorated";

class FakeEditContext implements EditContext {
	text = "";
	selectionStart = 0;
	selectionEnd = 0;
	private readonly listeners = new Map<string, Set<(event: Event) => void>>();
	updateText(): void {}
	updateSelection(): void {}
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
		requestDomFocus: () => false,
		applyDomTextSelection: () => {},
		syncTextSelection: () => {},
		syncCellTextSelection: () => {},
		selectAllBehavior: "block-first" as const,
		...stubFieldEditorParts({ shouldProjectSelectionAfterReconcile }),
		setComposing: () => {},
		notifyDomReconciled: () => {},
	} as unknown as FieldEditorInputController;
	return { controller };
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
	const { controller } = stubController(
		editor,
		blockId,
		shouldProjectSelectionAfterReconcile,
	);
	const backend = createBackend(editor, controller);
	fixtures.push({ editor, backend });
	backend.activate(element, getYText(editor, blockId));
	// Counted from here, so the activation's own write is not one.
	const setBaseAndExtent = vi.spyOn(Selection.prototype, "setBaseAndExtent");
	const addRange = vi.spyOn(Selection.prototype, "addRange");
	const selectionWrites = () =>
		setBaseAndExtent.mock.calls.length + addRange.mock.calls.length;
	return { element, decorate, selectionWrites };
}

/** Opens and closes a composition that changes nothing (cancelled, or committed empty). */
type CompositionDriver = {
	start(element: HTMLElement): void;
	endUnchanged(element: HTMLElement): void;
};

function editContextOf(element: HTMLElement): FakeEditContext {
	return (element as HTMLElement & { editContext: FakeEditContext })
		.editContext;
}

const backends: Array<{
	name: string;
	create: (
		editor: Editor,
		controller: FieldEditorInputController,
	) => InputBackend;
	composition: CompositionDriver;
}> = [
	{
		name: "contenteditable",
		create: (editor: Editor, controller: FieldEditorInputController) =>
			new ContentEditableBackend(editor, controller),
		composition: {
			start: (element) =>
				element.dispatchEvent(new Event("compositionstart")),
			endUnchanged: (element) =>
				element.dispatchEvent(
					Object.assign(new Event("compositionend"), { data: "" }),
				),
		},
	},
	{
		name: "EditContext",
		create: (editor: Editor, controller: FieldEditorInputController) => {
			(globalThis as { EditContext?: unknown }).EditContext =
				FakeEditContext;
			return new EditContextBackend(editor, controller);
		},
		composition: {
			start: (element) => editContextOf(element).emit("compositionstart"),
			endUnchanged: (element) =>
				editContextOf(element).emit("compositionend", { data: "" }),
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
	vi.restoreAllMocks();
});

describe.each(backends)(
	"HOST9: $name decoration change while another control owns focus",
	({ create }) => {
		it("rebuilds the field without writing the selection back into the DOM", () => {
			const { element, decorate, selectionWrites } = mount(create, false);

			decorate();

			expect(
				element.querySelector(`[${DECORATION_ATTRIBUTE}]`),
			).not.toBeNull();
			expect(selectionWrites()).toBe(0);
		});

		it("still restores the selection when the field owns focus", () => {
			const { element, decorate, selectionWrites } = mount(create, true);

			decorate();

			expect(
				element.querySelector(`[${DECORATION_ATTRIBUTE}]`),
			).not.toBeNull();
			expect(selectionWrites()).toBeGreaterThan(0);
		});
	},
);

describe.each(backends)(
	"HOST9: $name decoration change during a composition",
	({ create, composition }) => {
		it("renders the decoration when the composition closes with no change", () => {
			const { element, decorate } = mount(create, true);

			composition.start(element);
			decorate();
			expect(
				element.querySelector(`[${DECORATION_ATTRIBUTE}]`),
				"deferred while the composition owns the field",
			).toBeNull();
			composition.endUnchanged(element);

			expect(
				element.querySelector(`[${DECORATION_ATTRIBUTE}]`),
			).not.toBeNull();
		});
	},
);

describe.each(backends)("HOST9: attaching the $name backend", ({ create }) => {
	function attach(focusOptions?: { passive: boolean }) {
		const { editor, blockId } = seedEditor();
		const element = inlineElement(blockId);
		const { controller } = stubController(editor, blockId, false);
		const backend = create(editor, controller);
		fixtures.push({ editor, backend });
		const setBaseAndExtent = vi.spyOn(Selection.prototype, "setBaseAndExtent");
		const addRange = vi.spyOn(Selection.prototype, "addRange");
		backend.activate(element, getYText(editor, blockId), focusOptions);
		return setBaseAndExtent.mock.calls.length + addRange.mock.calls.length;
	}

	it("passively writes no native range, which would take focus from the control holding it", () => {
		expect(attach({ passive: true })).toBe(0);
	});

	it("writes the record's native range when the attach may take focus", () => {
		expect(attach()).toBeGreaterThan(0);
	});
});

describe.each(backends)("S1/P3: an undo or redo rebuild of the $name field", ({ create }) => {
	function rebuildFromHistory(projectAfterRebuild?: (blockIds: readonly string[]) => void) {
		const { editor, blockId } = seedEditor();
		const element = inlineElement(blockId);
		const { controller } = stubController(editor, blockId, true);
		if (projectAfterRebuild) {
			(controller as { projectAfterRebuild?: unknown }).projectAfterRebuild =
				projectAfterRebuild;
		}
		const backend = create(editor, controller);
		fixtures.push({ editor, backend });
		backend.activate(element, getYText(editor, blockId));
		const setBaseAndExtent = vi.spyOn(Selection.prototype, "setBaseAndExtent");
		const addRange = vi.spyOn(Selection.prototype, "addRange");
		(
			backend as unknown as {
				handleYTextChange(event: unknown): void;
			}
		).handleYTextChange({
			delta: [],
			transaction: { origin: { [HISTORY_ORIGIN_TAG]: true }, local: true },
		});
		return {
			blockId,
			writes: setBaseAndExtent.mock.calls.length + addRange.mock.calls.length,
		};
	}

	it("projects through the projector, which applies HOST9 and the chrome rule, instead of writing the range itself", () => {
		const projected: Array<readonly string[]> = [];
		const { blockId, writes } = rebuildFromHistory((blockIds) => {
			projected.push(blockIds);
		});
		expect(projected).toEqual([[blockId]]);
		expect(writes).toBe(0);
	});

	it("still writes the range under a host-built controller with no projector part", () => {
		expect(rebuildFromHistory().writes).toBeGreaterThan(0);
	});
});
