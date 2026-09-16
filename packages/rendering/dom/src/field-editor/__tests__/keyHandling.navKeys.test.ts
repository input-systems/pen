import { createEditor, getCommandRegistry } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { handleFieldEditorKeyDown } from "../keyHandling";
import type { FieldEditorTextLike } from "../crdt";

const fixtures: Array<ReturnType<typeof createEditor>> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		fixtures.pop()?.destroy();
	}
});

function createKeyEvent(
	key: string,
	options: Partial<KeyboardEvent> = {},
): KeyboardEvent {
	let defaultPrevented = false;
	return {
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		isComposing: false,
		defaultPrevented,
		preventDefault() {
			defaultPrevented = true;
			Object.defineProperty(this, "defaultPrevented", {
				configurable: true,
				value: true,
			});
		},
		...options,
	} as KeyboardEvent;
}

function getYText(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): FieldEditorTextLike {
	const adapter = editor.internals.adapter;
	const doc = editor.internals.crdtDoc;
	const ydoc = adapter.raw<{
		getMap(name: string): {
			get(key: string): { get(field: string): unknown } | undefined;
		};
	}>(doc);
	const ytext = ydoc
		.getMap("blocks")
		.get(blockId)
		?.get("content") as FieldEditorTextLike | null;
	if (!ytext) {
		throw new Error(`Missing test Y.Text for block ${blockId}`);
	}
	return ytext;
}

function createFieldEditor(blockId: string) {
	return {
		focusBlockId: blockId,
		inputMode: "richtext" as const,
		activeCellCoord: null,
		activateCell: () => {},
		activateTextSelection: () => {},
		commitProgrammaticTextSelection: () => {},
		deactivate: () => {},
		selectAllBehavior: "block-first" as const,
	};
}

describe("K1 unbound navigation keys", () => {
	it("K1: PageDown preventDefaults and leaves the caret put", () => {
		const editor = createEditor({ schema: defaultSchema });
		fixtures.push(editor);
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hello World",
			},
		]);
		editor.selectText(blockId, 11, 11);

		const event = createKeyEvent("PageDown");
		const handled = handleFieldEditorKeyDown({
			event,
			editor,
			fieldEditor: createFieldEditor(blockId),
			ytext: getYText(editor, blockId),
			range: { start: 11, end: 11 },
		});

		expect(handled).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId, offset: 11 },
		});
	});

	it("K1: PageDown during composition is not intercept", () => {
		const editor = createEditor({ schema: defaultSchema });
		fixtures.push(editor);
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		const event = createKeyEvent("PageDown", { isComposing: true });
		const handled = handleFieldEditorKeyDown({
			event,
			editor,
			fieldEditor: createFieldEditor(blockId),
			ytext: getYText(editor, blockId),
			range: { start: 0, end: 0 },
		});

		expect(handled).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});
});

describe("M3 Home dispatch", () => {
	it("M3: Home dispatches pen.caretLineStart and moves the authority", () => {
		const editor = createEditor({ schema: defaultSchema });
		fixtures.push(editor);
		const registry = getCommandRegistry(editor);
		if (!registry) {
			throw new Error("expected command registry");
		}
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hello World",
			},
		]);
		editor.selectText(blockId, 5, 5);

		const dispatched: string[] = [];
		const originalDispatch = registry.dispatch.bind(registry);
		registry.dispatch = ((command, param, context) => {
			dispatched.push(command.name);
			return originalDispatch(command, param, context);
		}) as typeof registry.dispatch;

		const previousPlatform = navigator.platform;
		Object.defineProperty(navigator, "platform", {
			configurable: true,
			value: "Linux x86_64",
		});
		try {
			const event = createKeyEvent("Home");
			const handled = handleFieldEditorKeyDown({
				event,
				editor,
				fieldEditor: createFieldEditor(blockId),
				ytext: getYText(editor, blockId),
				range: { start: 5, end: 5 },
			});

			expect(handled).toBe(true);
			expect(event.defaultPrevented).toBe(true);
			expect(dispatched).toContain("pen.caretLineStart");
			expect(editor.selection).toMatchObject({
				type: "text",
				focus: { blockId, offset: 0 },
			});
		} finally {
			Object.defineProperty(navigator, "platform", {
				configurable: true,
				value: previousPlatform,
			});
		}
	});
});

describe("word selection extension", () => {
	it("preserves a backward anchor across repeated Alt+Shift+ArrowLeft", () => {
		const editor = createEditor({ schema: defaultSchema });
		fixtures.push(editor);
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "one two three",
			},
		]);
		editor.selectText(blockId, 13, 13);
		const fieldEditor = createFieldEditor(blockId);

		const previousPlatform = navigator.platform;
		Object.defineProperty(navigator, "platform", {
			configurable: true,
			value: "MacIntel",
		});
		try {
			expect(
				handleFieldEditorKeyDown({
					event: createKeyEvent("ArrowLeft", {
						altKey: true,
						shiftKey: true,
					}),
					editor,
					fieldEditor,
					ytext: getYText(editor, blockId),
					range: { start: 13, end: 13 },
				}),
			).toBe(true);
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 13 },
				focus: { blockId, offset: 8 },
			});

			expect(
				handleFieldEditorKeyDown({
					event: createKeyEvent("ArrowLeft", {
						altKey: true,
						shiftKey: true,
					}),
					editor,
					fieldEditor,
					ytext: getYText(editor, blockId),
					range: { start: 8, end: 13 },
				}),
			).toBe(true);
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 13 },
				focus: { blockId, offset: 4 },
			});
		} finally {
			Object.defineProperty(navigator, "platform", {
				configurable: true,
				value: previousPlatform,
			});
		}
	});
});
