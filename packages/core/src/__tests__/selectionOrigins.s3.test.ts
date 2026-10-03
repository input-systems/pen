import type { DiagnosticEvent, SelectionOrigin } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import {
	createEditor as createCoreEditor,
	getEditorSelectionRecord,
} from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createEditor() {
	const editor = createCoreEditor({
		schema: createDefaultSchema(),
		preset: noDefaultExtensionsPreset,
	});
	const seed = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId: seed, from: 0, to: 0, insert: "hello" },
		{
			type: "insert-block",
			blockId: "second",
			blockType: "paragraph",
			props: {},
			position: "last",
		},
		{
			type: "splice-text",
			blockId: "second",
			from: 0,
			to: 0,
			insert: "world",
		},
		{
			type: "insert-block",
			blockId: "grid",
			blockType: "table",
			props: {},
			position: "last",
		},
	]);
	return { editor, seed };
}

type Setter = {
	name: string;
	write: (
		editor: ReturnType<typeof createEditor>["editor"],
		seed: string,
		options?: { origin?: SelectionOrigin },
	) => void;
};

const SETTERS: readonly Setter[] = [
	{
		name: "selectBlock",
		write: (editor, _seed, options) => editor.selectBlock("second", options),
	},
	{
		name: "selectBlocks",
		write: (editor, seed, options) =>
			editor.selectBlocks([seed, "second"], options),
	},
	{
		name: "selectCell",
		write: (editor, _seed, options) => editor.selectCell("grid", 0, 0, options),
	},
	{
		name: "selectCellRange",
		write: (editor, _seed, options) =>
			editor.selectCellRange(
				"grid",
				{ row: 0, col: 0 },
				{ row: 0, col: 1 },
				options,
			),
	},
	{
		name: "selectText",
		write: (editor, seed, options) => editor.selectText(seed, 1, 3, options),
	},
	{
		name: "selectTextRange",
		write: (editor, seed, options) =>
			editor.selectTextRange(
				{ blockId: seed, offset: 2 },
				{ blockId: "second", offset: 2 },
				options,
			),
	},
	{
		name: "selectAll",
		write: (editor, _seed, options) => editor.selectAll(undefined, options),
	},
];

describe("selection setter origins", () => {
	it.each(SETTERS)(
		"S3: every convenience setter accepts an origin and defaults to programmatic ($name)",
		({ write }) => {
			const withOrigin = createEditor();
			write(withOrigin.editor, withOrigin.seed, { origin: "keyboard" });
			expect(getEditorSelectionRecord(withOrigin.editor)?.origin).toBe(
				"keyboard",
			);
			withOrigin.editor.destroy();

			const byDefault = createEditor();
			byDefault.editor.selectText(byDefault.seed, 0, 0, { origin: "pointer" });
			write(byDefault.editor, byDefault.seed);
			expect(getEditorSelectionRecord(byDefault.editor)?.origin).toBe(
				"programmatic",
			);
			byDefault.editor.destroy();
		},
	);

	it.each(SETTERS)(
		"A4: a setter origin of gc is rejected ($name)",
		({ write }) => {
			const { editor, seed } = createEditor();
			editor.selectText(seed, 0, 0, { origin: "pointer" });
			const before = getEditorSelectionRecord(editor);
			const diagnostics: DiagnosticEvent[] = [];
			editor.on("diagnostic", (event) => diagnostics.push(event));

			write(editor, seed, { origin: "gc" });

			const after = getEditorSelectionRecord(editor);
			expect(after?.version).toBe(before?.version);
			expect(after?.origin).toBe("pointer");
			expect(diagnostics.map((event) => event.code)).toContain(
				"selection-reserved-origin",
			);
			editor.destroy();
		},
	);
});
