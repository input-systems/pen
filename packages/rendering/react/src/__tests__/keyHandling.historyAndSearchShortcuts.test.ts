import { describe, expect, it } from "vitest";
import { keymapFacet } from "@input/pen-core";
import { getSearchController, searchExtension } from "@input/pen-search";
import { defineExtension } from "@input/pen-core";
import {
	handleEditorKeyBindings,
} from "@input/pen-dom/field-editor/keyHandling";
import {
	createKeyEvent,
	createPresetEditor,
	withNavigatorPlatform,
} from "./utils/keyHandlingTestHelpers";

describe("@input/pen-react key binding contexts: history and search shortcuts", () => {
	it("handles macOS undo and redo shortcuts without native history events", () => {
		const editor = createPresetEditor({
			preset: {
				tools: false,
				deltaStream: false,
				shortcuts: false,
			},
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);

		withNavigatorPlatform("MacIntel", () => {
			expect(
				handleEditorKeyBindings(
					editor,
					createKeyEvent("z", { metaKey: true }),
				),
			).toBe(true);
			expect(editor.getBlock(blockId)?.textContent()).toBe("");

			expect(
				handleEditorKeyBindings(
					editor,
					createKeyEvent("z", { metaKey: true, shiftKey: true }),
				),
			).toBe(true);
			expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		});

		editor.destroy();
	});

	it("prefers history override bindings before generic undo", () => {
		let handled = 0;
		const editor = createPresetEditor({
			preset: {
				tools: false,
				deltaStream: false,
				shortcuts: false,
			},
			extensions: [
				defineExtension({
					name: "history-override",
					facets: [
						keymapFacet.of([
							{
								key: "Mod-z",
								priority: 1000,
								handler: () => {
									handled += 1;
									return true;
								},
							},
						]),
					],
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);

		withNavigatorPlatform("Win32", () => {
			expect(
				handleEditorKeyBindings(
					editor,
					createKeyEvent("z", { ctrlKey: true }),
				),
			).toBe(true);
		});
		expect(handled).toBe(1);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("opens search with Mod-f on macOS and Windows", () => {
		const editor = createPresetEditor({
			preset: {
				tools: false,
				deltaStream: false,
				undo: false,
				shortcuts: false,
			},
			extensions: [searchExtension()],
		});

		withNavigatorPlatform("MacIntel", () => {
			expect(
				handleEditorKeyBindings(
					editor,
					createKeyEvent("f", { metaKey: true }),
				),
			).toBe(true);
		});
		expect(getSearchController(editor)?.getState().open).toBe(true);

		getSearchController(editor)?.close();

		withNavigatorPlatform("Win32", () => {
			expect(
				handleEditorKeyBindings(
					editor,
					createKeyEvent("f", { ctrlKey: true }),
				),
			).toBe(true);
		});
		expect(getSearchController(editor)?.getState().open).toBe(true);

		editor.destroy();
	});

	it("navigates and closes search with Enter, Shift-Enter, and Escape", () => {
		const editor = createPresetEditor({
			preset: {
				tools: false,
				deltaStream: false,
				undo: false,
				shortcuts: false,
			},
			extensions: [searchExtension()],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "alpha beta alpha",
			},
		]);

		const controller = getSearchController(editor);
		controller?.open();
		controller?.setQuery("alpha");

		expect(handleEditorKeyBindings(editor, createKeyEvent("Enter"))).toBe(
			true,
		);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 11 },
			focus: { blockId, offset: 16 },
		});

		expect(
			handleEditorKeyBindings(
				editor,
				createKeyEvent("Enter", { shiftKey: true }),
			),
		).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
		});

		expect(handleEditorKeyBindings(editor, createKeyEvent("Escape"))).toBe(
			true,
		);
		expect(controller?.getState().open).toBe(false);

		editor.destroy();
	});

	it("navigates search with Mod-g and Shift-Mod-g on macOS and Windows", () => {
		const editor = createPresetEditor({
			preset: {
				tools: false,
				deltaStream: false,
				undo: false,
				shortcuts: false,
			},
			extensions: [searchExtension()],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "alpha beta alpha",
			},
		]);

		const controller = getSearchController(editor);
		controller?.open();
		controller?.setQuery("alpha");

		withNavigatorPlatform("MacIntel", () => {
			expect(
				handleEditorKeyBindings(
					editor,
					createKeyEvent("g", { metaKey: true }),
				),
			).toBe(true);
		});
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 11 },
			focus: { blockId, offset: 16 },
		});

		withNavigatorPlatform("MacIntel", () => {
			expect(
				handleEditorKeyBindings(
					editor,
					createKeyEvent("g", { metaKey: true, shiftKey: true }),
				),
			).toBe(true);
		});
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
		});

		withNavigatorPlatform("Win32", () => {
			expect(
				handleEditorKeyBindings(
					editor,
					createKeyEvent("g", { ctrlKey: true }),
				),
			).toBe(true);
		});
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 11 },
			focus: { blockId, offset: 16 },
		});

		withNavigatorPlatform("Win32", () => {
			expect(
				handleEditorKeyBindings(
					editor,
					createKeyEvent("g", { ctrlKey: true, shiftKey: true }),
				),
			).toBe(true);
		});
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
		});

		editor.destroy();
	});
});
