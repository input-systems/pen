import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { editDocumentReviewPreviewInput } from "../controller/streamingPreviewInput";
import { extractEditDocumentPreview } from "../runtime/editDocumentPreview";

/**
 * RS6: the `edit_document` preview maps each operation to what it changes.
 * The corpus property (`rs6.previewFidelity.test.ts`) proves the composed
 * result; these pin the mapping it rests on.
 */

const SESSION = { sessionId: "session-1", turnId: "turn-1" } as const;

let editor: Editor | null = null;

function createParagraphs(texts: Record<string, string>): Editor {
	const created = createEditor({ schema: defaultSchema });
	created.apply(
		Object.entries(texts).flatMap(([blockId, text]) => [
			{
				type: "insert-block" as const,
				blockId,
				blockType: "paragraph",
				props: {},
				position: "last" as const,
			},
			{
				type: "splice-text" as const,
				blockId,
				from: 0,
				to: 0,
				insert: text,
			},
		]),
		{ origin: "system" },
	);
	editor = created;
	return created;
}

afterEach(() => {
	editor?.destroy();
	editor = null;
});

describe("RS6: edit_document preview mapping", () => {
	it("RS6: the preview names every block a multi-target operation addresses", () => {
		const update = extractEditDocumentPreview(
			'{"operations":[{"operation":"replace_blocks","blockIds":["a","b","c"],"markdown":"1. One\\n2. Two\\n',
			"call-1",
		);
		expect(update).toMatchObject({
			blockId: "a",
			blockIds: ["a", "b", "c"],
			complete: false,
		});
		// An id still arriving is held back, like any other id.
		expect(
			extractEditDocumentPreview(
				'{"operations":[{"operation":"delete_blocks","blockIds":["a","b","c',
				"call-1",
			)?.blockIds,
		).toEqual(["a", "b"]);

		const live = createParagraphs({ a: "Alpha", b: "Beta", c: "Gamma" });
		const replace = editDocumentReviewPreviewInput(live, {
			...SESSION,
			operationIndex: 0,
			blockIds: ["c", "a", "b"],
			placement: null,
			operation: "replace_blocks",
			text: "One\nTwo\n",
			complete: true,
		});
		expect(replace?.target).toEqual({
			kind: "block-range",
			start: { blockId: "a", offset: 0 },
			end: { blockId: "c", offset: 5 },
			blockIds: ["a", "b", "c"],
		});
		// A trailing line break ends the markdown, not a block.
		expect(replace?.text).toBe("One\nTwo");

		const remove = editDocumentReviewPreviewInput(live, {
			...SESSION,
			operationIndex: 1,
			blockIds: ["a", "b"],
			placement: null,
			operation: "delete_blocks",
			text: "",
			complete: true,
		});
		expect(remove).toMatchObject({
			deletesBlocks: true,
			text: "",
			target: { kind: "block-range", blockIds: ["a", "b"] },
		});
	});

	it("RS6: an insert placed before a block previews before it", () => {
		expect(
			extractEditDocumentPreview(
				'{"operations":[{"operation":"insert_blocks","blockId":"b","placement":"before","markdown":"## Outlook\\n"}]}',
				"call-1",
			),
		).toMatchObject({ placement: "before", complete: true });

		const live = createParagraphs({ a: "Alpha", b: "Beta" });
		const base = {
			...SESSION,
			operationIndex: 0,
			blockIds: ["b"],
			operation: "insert_blocks",
			text: "Outlook\n",
			complete: true,
		};
		expect(
			editDocumentReviewPreviewInput(live, {
				...base,
				placement: "before",
			}),
		).toMatchObject({
			target: { kind: "insertion-point", blockId: "b", offset: 0 },
			text: "Outlook\n",
		});
		expect(
			editDocumentReviewPreviewInput(live, {
				...base,
				placement: "after",
			}),
		).toMatchObject({
			target: { kind: "insertion-point", blockId: "b", offset: 4 },
			text: "\nOutlook",
		});
	});

	it("RS6: move, format, and prop operations preview no text", () => {
		const live = createParagraphs({ a: "Alpha", b: "Beta" });
		for (const operation of [
			"move_block",
			"format_text",
			"set_block_props",
			null,
		]) {
			expect(
				editDocumentReviewPreviewInput(live, {
					...SESSION,
					operationIndex: 0,
					blockIds: ["a"],
					placement: "before",
					operation,
					text: "",
					complete: true,
				}),
			).toBeNull();
		}
	});

	it("RS6 N6: a replace over a block with an inline atom covers its logical length", () => {
		const live = createParagraphs({ a: "Hi " });
		live.apply(
			[
				{
					type: "splice-text",
					blockId: "a",
					from: 3,
					to: 3,
					insert: {
						nodeType: "mention",
						props: { id: "user-1", label: "Ada" },
					},
				},
			],
			{ origin: "system" },
		);
		const block = live.getBlock("a")!;
		expect(block.length()).toBe(4);

		const preview = editDocumentReviewPreviewInput(live, {
			...SESSION,
			operationIndex: 0,
			blockIds: ["a"],
			placement: null,
			operation: "replace_block_text",
			text: "Hello",
			complete: true,
		});
		expect(preview?.target).toEqual({
			kind: "text-range",
			blockId: "a",
			from: 0,
			to: block.length(),
		});
	});
});
