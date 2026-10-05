import {
	createEditor,
	defineBlock,
	mergeSchemas,
	prop,
	SchemaRegistryImpl,
} from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { afterEach, describe, expect, it } from "vitest";
import { isPreorderForward, type ContentGesturesContext } from "../../field-editor/contentGesturesShared";
import { getPreorderBlockIds } from "../documentPreorder";

const emailQuote = defineBlock("emailQuote", {
	content: [],
	isContainer: true,
	fieldEditor: "none",
	props: {
		open: prop.boolean().default(true),
	},
});

const fixtures: Array<ReturnType<typeof createEditor>> = [];

afterEach(() => {
	while (fixtures.length > 0) {
		fixtures.pop()?.destroy();
	}
});

function createNestedQuoteEditor() {
	const editor = createEditor({
		schema: mergeSchemas(
			defaultSchema,
			new SchemaRegistryImpl({
				blocks: [emailQuote],
				inlines: [],
			}),
		),
	});
	fixtures.push(editor);
	const initial = editor.firstBlock();
	editor.apply(
		[
			...(initial
				? [{ type: "delete-block" as const, blockId: initial.id }]
				: []),
			{
				type: "insert-block",
				blockId: "quote",
				blockType: "emailQuote",
				props: { open: true },
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "q1",
				blockType: "paragraph",
				props: {},
				position: { parent: "quote", index: 0 },
			},
			{
				type: "insert-block",
				blockId: "q2",
				blockType: "paragraph",
				props: {},
				position: { parent: "quote", index: 1 },
			},
		],
		{ origin: "user" },
	);
	return editor;
}

describe("D6 nested pointer block range", () => {
	it("isPreorderForward orders children-array children absent from blockOrder", () => {
		const editor = createNestedQuoteEditor();
		expect(editor.documentState.blockOrder).not.toContain("q1");
		expect(getPreorderBlockIds(editor)).toEqual(["quote", "q1", "q2"]);

		const ctx = { editor } as ContentGesturesContext;
		expect(isPreorderForward(ctx, "q1", "q2")).toBe(true);
		expect(isPreorderForward(ctx, "q2", "q1")).toBe(false);
	});
});
