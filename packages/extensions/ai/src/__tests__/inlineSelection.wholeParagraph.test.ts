import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import type { Editor, ModelRequestedOperation } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { deltaStreamExtension } from "../stream";
import { acceptAllSuggestions, aiExtension, getAIController } from "../index";

/**
 * A live selection covering whole paragraphs rewrites through a block scope so
 * the reply lands as blocks; a text splice would fold every paragraph the
 * model returns into the first block (`spec/packages/extensions/ai.md`).
 */
describe("inline-edit: whole-paragraph selections rewrite as markdown blocks", () => {
	function createRewriteEditor(reply: string) {
		const operations: ModelRequestedOperation[] = [];
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream(options) {
							if (options.operation) {
								operations.push(options.operation);
							}
							yield { type: "text-delta" as const, delta: reply };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		return { editor, operations };
	}

	it("replaces the selected blocks with the paragraphs the model returns", async () => {
		const { editor, operations } = createRewriteEditor(
			"New one.\n\nNew two.",
		);
		seedBlocks(editor, [
			["paragraph", "Old one."],
			["paragraph", "Old two."],
		]);
		editor.selectTextRange(
			{ blockId: "b1", offset: 0 },
			{ blockId: "b2", offset: "Old two.".length },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Make it friendlier",
		);

		expect(generation.status).toBe("complete");
		expect(operations[0]?.target).toMatchObject({
			kind: "scoped-range",
			scope: "block",
			contentFormat: "markdown",
			blockIds: ["b1", "b2"],
		});

		expect(generation.contentFormat).toBe("markdown");
		expect(generation.mutationReceipt?.status).toBe("staged_suggestions");

		acceptAllSuggestions(editor);
		expect(blockTexts(editor)).toEqual(["New one.", "New two."]);
		editor.destroy();
	});

	it("splits a reply that outgrows the single paragraph it rewrites", async () => {
		const { editor, operations } = createRewriteEditor(
			"New one.\n\nNew two.",
		);
		seedBlocks(editor, [["paragraph", "Old one."]]);
		editor.selectTextRange(
			{ blockId: "b1", offset: 0 },
			{ blockId: "b1", offset: "Old one.".length },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Expand this");

		expect(operations[0]?.target).toMatchObject({
			kind: "scoped-range",
			scope: "block",
			contentFormat: "markdown",
			blockIds: ["b1"],
		});
		acceptAllSuggestions(editor);
		expect(blockTexts(editor)).toEqual(["New one.", "New two."]);
		editor.destroy();
	});

	it("drops a trailing block the selection only touches at offset 0", async () => {
		const { editor, operations } = createRewriteEditor("Rewritten");
		seedBlocks(editor, [
			["paragraph", "Old one."],
			["paragraph", "Old two."],
			["paragraph", "Kept."],
		]);
		editor.selectTextRange(
			{ blockId: "b1", offset: 0 },
			{ blockId: "b3", offset: 0 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Shorten");

		expect(operations[0]?.target).toMatchObject({
			kind: "scoped-range",
			blockIds: ["b1", "b2"],
		});
		acceptAllSuggestions(editor);
		expect(blockTexts(editor)).toEqual(["Rewritten", "Kept."]);
		editor.destroy();
	});

	it("keeps a partial selection on the text splice path", async () => {
		const { editor, operations } = createRewriteEditor("Rewritten");
		seedBlocks(editor, [
			["paragraph", "Old one."],
			["paragraph", "Old two."],
		]);
		editor.selectTextRange(
			{ blockId: "b1", offset: 4 },
			{ blockId: "b2", offset: 3 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Shorten");

		expect(operations[0]?.target.kind).toBe("selection");
		editor.destroy();
	});

	it("keeps a selection reaching a non-paragraph block on the text splice path", async () => {
		const { editor, operations } = createRewriteEditor("Shorter title");
		seedBlocks(editor, [
			["heading", "Old title"],
			["paragraph", "Old one."],
		]);
		editor.selectTextRange(
			{ blockId: "b1", offset: 0 },
			{ blockId: "b1", offset: "Old title".length },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Shorten");

		expect(operations[0]?.target.kind).toBe("selection");
		acceptAllSuggestions(editor);
		expect(blockTypes(editor)).toEqual(["heading", "paragraph"]);
		expect(blockTexts(editor)).toEqual(["Shorter title", "Old one."]);
		editor.destroy();
	});
});

function seedBlocks(
	editor: Editor,
	blocks: readonly (readonly [type: string, text: string])[],
): void {
	const seedBlockId = editor.firstBlock()!.id;
	editor.apply([
		...blocks.flatMap(([blockType, text], index) => {
			const blockId = `b${index + 1}`;
			return [
				{
					type: "insert-block" as const,
					blockId,
					blockType,
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
			];
		}),
		{ type: "delete-block" as const, blockId: seedBlockId },
	]);
}

function blockTexts(editor: Editor): string[] {
	return editor.documentState.blockOrder.map(
		(blockId) => editor.getBlock(blockId)?.textContent() ?? "",
	);
}

function blockTypes(editor: Editor): string[] {
	return editor.documentState.blockOrder.map(
		(blockId) => editor.getBlock(blockId)?.type ?? "",
	);
}
