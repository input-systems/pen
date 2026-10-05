import { afterEach, describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor, Extension } from "@input/pen-types";
import { toolsExtension } from "@input/pen-tools";
import { undoExtension } from "@input/pen-undo";
import {
	editDocumentReviewPreviewInput,
	type EditDocumentReviewPreviewSource,
} from "../controller/streamingPreviewInput";
import { aiExtension, getAIController } from "../index";
import { buildStreamingReviewPreviewDecorations } from "../review/reviewPresentation";
import { deltaStreamExtension } from "../stream";
import { extractEditDocumentPreview } from "../runtime/editDocumentPreview";

/**
 * RS6: the `edit_document` preview maps each operation to what it changes.
 * The corpus property (`rs6.previewFidelity.test.ts`) proves the composed
 * result; these pin the mapping it rests on.
 */

let editor: Editor | null = null;

function createParagraphs(
	texts: Record<string, string>,
	extensions: Extension[] = [],
): Editor {
	const created = createEditor({ schema: defaultSchema, extensions });
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

/** The preview for one complete operation, the first of its turn. */
function previewInput(
	live: Editor,
	source: Pick<EditDocumentReviewPreviewSource, "operation" | "blockIds"> &
		Partial<EditDocumentReviewPreviewSource>,
) {
	return editDocumentReviewPreviewInput(live, {
		sessionId: "session-1",
		turnId: "turn-1",
		operationIndex: 0,
		placement: null,
		text: "",
		complete: true,
		...source,
	});
}

function createNested(): Editor {
	const created = createParagraphs({ a: "Alpha" });
	created.apply(
		[
			{
				type: "insert-block",
				blockId: "t",
				blockType: "toggle",
				props: {},
				position: "last",
			},
			{ type: "splice-text", blockId: "t", from: 0, to: 0, insert: "Toggle" },
			...["c1", "c2", "c3"].flatMap((blockId, index) => [
				{
					type: "insert-block" as const,
					blockId,
					blockType: "paragraph",
					props: {},
					position: { parent: "t", index },
				},
				{
					type: "splice-text" as const,
					blockId,
					from: 0,
					to: 0,
					insert: `Child ${index + 1}`,
				},
			]),
		],
		{ origin: "system" },
	);
	return created;
}

function hiddenBlockIds(
	live: Editor,
	input: ReturnType<typeof editDocumentReviewPreviewInput>,
): string[] {
	return buildStreamingReviewPreviewDecorations({
		editor: live,
		preview: { ...input!, previousTextLength: 0 },
		suggestionPresentation: "final-text",
	})
		.filter((decoration) => decoration.type === "block")
		.map((decoration) => decoration.blockId);
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
		const replace = previewInput(live, {
			blockIds: ["c", "a", "b"],
			operation: "replace_blocks",
			text: "One\nTwo\n",
		});
		expect(replace?.target).toEqual({
			kind: "block-range",
			start: { blockId: "a", offset: 0 },
			end: { blockId: "c", offset: 5 },
			blockIds: ["a", "b", "c"],
		});
		// A trailing line break ends the markdown, not a block.
		expect(replace?.text).toBe("One\nTwo");

		const remove = previewInput(live, {
			operationIndex: 1,
			blockIds: ["a", "b"],
			operation: "delete_blocks",
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
		const insert = (placement: "before" | "after") =>
			previewInput(live, {
				blockIds: ["b"],
				operation: "insert_blocks",
				text: "Outlook\n",
				placement,
			});
		expect(insert("before")).toMatchObject({
			target: { kind: "insertion-point", blockId: "b", offset: 0 },
			text: "Outlook\n",
		});
		expect(insert("after")).toMatchObject({
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
				previewInput(live, {
					blockIds: ["a"],
					placement: "before",
					operation,
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

		const preview = previewInput(live, {
			blockIds: ["a"],
			operation: "replace_block_text",
			text: "Hello",
		});
		expect(preview?.target).toEqual({
			kind: "text-range",
			blockId: "a",
			from: 0,
			to: block.length(),
		});
	});

	it("RS6: a delete of nested blocks names and hides every one of them", () => {
		const live = createNested();
		const input = previewInput(live, {
			blockIds: ["c2", "c1"],
			operation: "delete_blocks",
		});
		expect(input?.target).toEqual({
			kind: "block-range",
			start: { blockId: "c1", offset: 0 },
			end: { blockId: "c2", offset: 7 },
			blockIds: ["c1", "c2"],
		});
		expect(hiddenBlockIds(live, input)).toEqual(["c1", "c2"]);
	});

	it("RS6: a replace of nested blocks covers every named block", () => {
		const live = createNested();
		const input = previewInput(live, {
			blockIds: ["c1", "c2", "c3"],
			operation: "replace_blocks",
			text: "New",
		});
		expect(input?.target).toMatchObject({
			kind: "block-range",
			start: { blockId: "c1", offset: 0 },
			end: { blockId: "c3", offset: 7 },
			blockIds: ["c1", "c2", "c3"],
		});
		expect(hiddenBlockIds(live, input)).toContain("c2");
	});

	it("RS6: a replace hides an empty block at the edge of the range it removes", () => {
		const live = createParagraphs({ a: "Alpha", b: "Beta", e: "" });
		const input = previewInput(live, {
			blockIds: ["a", "b", "e"],
			operation: "replace_blocks",
			text: "Replaced",
		});
		expect(hiddenBlockIds(live, input)).toEqual(
			expect.arrayContaining(["b", "e"]),
		);
	});

	it("RS6: replace_block_text with empty text previews clearing the block", () => {
		const live = createParagraphs({ a: "Alpha" }, [
			undoExtension(),
			toolsExtension(),
			deltaStreamExtension(),
			aiExtension(),
		]);
		const input = previewInput(live, {
			blockIds: ["a"],
			operation: "replace_block_text",
		});
		expect(input).toMatchObject({
			text: "",
			target: { kind: "text-range", blockId: "a", from: 0, to: 5 },
		});

		const controller = getAIController(live)!;
		controller.setStreamingReviewPreview(input!);
		const previews = controller.getState().streamingReviewPreviews;
		expect(previews).toHaveLength(1);
		const struck = buildStreamingReviewPreviewDecorations({
			editor: live,
			preview: previews[0]!,
			suggestionPresentation: "track-changes",
		}).filter((decoration) => decoration.type === "inline");
		expect(struck).toMatchObject([{ blockId: "a", from: 0, to: 5 }]);

		// Nothing arrived yet is still a withdrawal, not a clear.
		controller.setStreamingReviewPreview({ ...input!, complete: false });
		expect(controller.getState().streamingReviewPreviews).toEqual([]);
	});
});
