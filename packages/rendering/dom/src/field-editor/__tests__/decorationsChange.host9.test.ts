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
import { EditContextBackend } from "../editContextBackend";
import type { InputBackend } from "../../internal/inputBackend";
import {
	contextOf,
	getYText,
	installFakeEditContext,
	mountBlockDom,
	removeEditContext,
} from "./fieldEditorFixtures.testHelpers";
import { stubFieldEditorParts } from "./fieldEditorParts.testHelpers";

const TEXT = "Hello world";
const DECORATION_ATTRIBUTE = "data-test-decorated";

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

type MountOptions = {
	shouldProjectSelectionAfterReconcile?: boolean;
	/** Counts the activation's own selection writes too. */
	countActivation?: boolean;
	focusOptions?: { passive: boolean };
	projectAfterRebuild?: (blockIds: readonly string[]) => void;
};

/** A backend activated on the decorated block; `selectionWrites` counts native range writes. */
function mount(
	createBackend: (
		editor: Editor,
		controller: FieldEditorInputController,
	) => InputBackend,
	options: MountOptions = {},
) {
	const { editor, blockId, decorate } = seedEditor();
	const { inline: element } = mountBlockDom(blockId, TEXT);
	const { controller } = stubController(
		editor,
		blockId,
		options.shouldProjectSelectionAfterReconcile ?? true,
	);
	if (options.projectAfterRebuild) {
		(controller as { projectAfterRebuild?: unknown }).projectAfterRebuild =
			options.projectAfterRebuild;
	}
	const backend = createBackend(editor, controller);
	fixtures.push({ editor, backend });
	const activate = () =>
		backend.activate(
			element,
			getYText(editor, blockId),
			options.focusOptions,
		);
	if (!options.countActivation) activate();
	const setBaseAndExtent = vi.spyOn(Selection.prototype, "setBaseAndExtent");
	const addRange = vi.spyOn(Selection.prototype, "addRange");
	if (options.countActivation) activate();
	const selectionWrites = () =>
		setBaseAndExtent.mock.calls.length + addRange.mock.calls.length;
	return { element, blockId, backend, decorate, selectionWrites };
}

/** Opens and closes a composition that changes nothing (cancelled, or committed empty). */
type CompositionDriver = {
	start(element: HTMLElement): void;
	endUnchanged(element: HTMLElement): void;
};

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
			installFakeEditContext();
			return new EditContextBackend(editor, controller);
		},
		composition: {
			start: (element) => contextOf(element).emit("compositionstart"),
			endUnchanged: (element) =>
				contextOf(element).emit("compositionend", { data: "" }),
		},
	},
];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.backend.deactivate();
		fixture.editor.destroy();
	}
	document.body.replaceChildren();
	removeEditContext();
	vi.restoreAllMocks();
});

describe.each(backends)(
	"HOST9: $name decoration change while another control owns focus",
	({ create }) => {
		it("rebuilds the field without writing the selection back into the DOM", () => {
			const { element, decorate, selectionWrites } = mount(create, {
				shouldProjectSelectionAfterReconcile: false,
			});

			decorate();

			expect(
				element.querySelector(`[${DECORATION_ATTRIBUTE}]`),
			).not.toBeNull();
			expect(selectionWrites()).toBe(0);
		});

		it("still restores the selection when the field owns focus", () => {
			const { element, decorate, selectionWrites } = mount(create);

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
			const { element, decorate } = mount(create);

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
	it("passively writes no native range, which would take focus from the control holding it", () => {
		expect(
			mount(create, {
				shouldProjectSelectionAfterReconcile: false,
				countActivation: true,
				focusOptions: { passive: true },
			}).selectionWrites(),
		).toBe(0);
	});

	it("writes the record's native range when the attach may take focus", () => {
		expect(
			mount(create, {
				shouldProjectSelectionAfterReconcile: false,
				countActivation: true,
			}).selectionWrites(),
		).toBeGreaterThan(0);
	});
});

describe.each(backends)(
	"S1/P3: an undo or redo rebuild of the $name field",
	({ create }) => {
		function rebuildFromHistory(
			projectAfterRebuild?: (blockIds: readonly string[]) => void,
		) {
			const { backend, blockId, selectionWrites } = mount(create, {
				projectAfterRebuild,
			});
			(
				backend as unknown as {
					handleYTextChange(event: unknown): void;
				}
			).handleYTextChange({
				delta: [],
				transaction: {
					origin: { [HISTORY_ORIGIN_TAG]: true },
					local: true,
				},
			});
			return { blockId, writes: selectionWrites() };
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
	},
);
