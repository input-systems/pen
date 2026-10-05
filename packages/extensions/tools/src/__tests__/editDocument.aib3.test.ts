import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type {
	Editor,
	ToolAuthorityContext,
	ToolDestructiveResolver,
} from "@input/pen-types";
import { editDocumentTool, getDocumentToolRuntime } from "../index";
import { toolsExtension } from "../toolsExtension";

/**
 * AIB3 / D6: `edit_document` classifies destructiveness per call, from its
 * complete input and whether its writes stage, against the live document.
 */

const DIRECT: ToolAuthorityContext = { staged: false };
const STAGED: ToolAuthorityContext = { staged: true };

let editor: Editor;
let classify: ToolDestructiveResolver;

function seed(target: Editor): void {
	target.apply(
		[
			{
				type: "insert-block",
				blockId: "full",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "full",
				from: 0,
				to: 0,
				insert: "Revenue grew.",
			},
			{
				type: "insert-block",
				blockId: "empty",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		],
		{ origin: "system" },
	);
}

function call(...operations: unknown[]): unknown {
	return { operations };
}

beforeEach(async () => {
	editor = createEditor({
		schema: defaultSchema,
		extensions: [toolsExtension()],
	});
	await editor.whenReady();
	seed(editor);
	const destructive = editDocumentTool(editor).destructive;
	expect(typeof destructive).toBe("function");
	classify = destructive as ToolDestructiveResolver;
});

afterEach(() => {
	editor.destroy();
});

describe("AIB3: edit_document classifies destructiveness per call", () => {
	it("AIB3: edit_document staged is never destructive", () => {
		const removesEverything = call(
			{ operation: "delete_blocks", blockIds: ["full"] },
			{ operation: "replace_block_text", blockId: "full", text: "x" },
			{ operation: "replace_blocks", blockIds: ["full"], markdown: "x" },
		);
		expect(classify(removesEverything, DIRECT)).toBe(true);
		expect(classify(removesEverything, STAGED)).toBe(false);
	});

	it.each([
		{ operation: "replace_block_text", blockId: "full", text: "New" },
		{
			operation: "replace_blocks",
			blockIds: ["empty", "full"],
			markdown: "- a",
		},
		{ operation: "delete_blocks", blockIds: ["full"] },
		// Changes the content kind of a non-empty block.
		{ operation: "set_block_props", blockId: "full", blockType: "divider" },
	])("AIB3: direct %j is destructive", (operation) => {
		expect(classify(call(operation), DIRECT)).toBe(true);
	});

	it.each([
		{
			operation: "insert_blocks",
			blockId: "full",
			placement: "after",
			markdown: "More.",
		},
		{
			operation: "move_block",
			blockId: "empty",
			referenceBlockId: "full",
			placement: "before",
		},
		{
			operation: "format_text",
			blockId: "full",
			matchText: "Revenue",
			marks: { bold: true },
		},
		{ operation: "replace_block_text", blockId: "empty", text: "New" },
		// Every target is an empty text block.
		{ operation: "replace_blocks", blockIds: ["empty"], markdown: "- a" },
		{ operation: "delete_blocks", blockIds: ["empty"] },
		// A block that does not exist removes nothing; the compiler refuses it.
		{ operation: "delete_blocks", blockIds: ["missing"] },
		// Same content kind: the text stays on screen.
		{ operation: "set_block_props", blockId: "full", blockType: "heading" },
		// Nothing to lose (D37).
		{
			operation: "set_block_props",
			blockId: "empty",
			blockType: "divider",
		},
	])("AIB3: direct %j is not destructive", (operation) => {
		expect(classify(call(operation), DIRECT)).toBe(false);
	});

	it("AIB3: a payload with no operations array is not destructive", () => {
		expect(classify(null, DIRECT)).toBe(false);
		expect(classify("delete everything", DIRECT)).toBe(false);
		expect(classify({ operations: "delete_blocks" }, DIRECT)).toBe(false);
		expect(classify({ operations: [null, 7] }, DIRECT)).toBe(false);
	});

	it("AIB3: delete_block and write_document stay destructive", () => {
		const runtime = getDocumentToolRuntime(editor)!;
		expect(runtime.getTool("delete_block")?.destructive).toBe(true);
		expect(runtime.getTool("write_document")?.destructive).toBe(true);
	});
});
