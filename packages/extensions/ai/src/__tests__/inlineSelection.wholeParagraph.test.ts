import { describe, expect, it } from "vitest";
import { createEditor, defineBlock } from "@input/pen-core";
import type {
	AIRequestContext,
	Editor,
	ModelRequestedOperation,
	SchemaRegistry,
} from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { deltaStreamExtension } from "../stream";
import {
	acceptAllSuggestions,
	aiEgressExtension,
	aiExtension,
	getAIController,
} from "../index";

/**
 * A live selection covering whole markdown blocks rewrites through a block
 * scope so the reply lands as blocks; a text splice would fold every block the
 * model returns into the first block (`spec/packages/extensions/ai.md`).
 */
describe("inline-edit: whole-block selections rewrite as markdown", () => {
	function createRewriteEditor(
		reply: string,
		mutationPreference: "suggestions" | "direct" = "suggestions",
		schema: SchemaRegistry = defaultSchema,
		contentFormat?: { selectionRewrite?: "text" | "markdown" },
	) {
		const operations: ModelRequestedOperation[] = [];
		const prompts: string[] = [];
		const requests: AIRequestContext[] = [];
		const editor = createEditor({
			schema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiEgressExtension((request) => {
					requests.push(request);
					return request;
				}),
				aiExtension({
					mutationPreference,
					contentFormat,
					model: {
						async *stream(options) {
							prompts.push(
								String(options.messages[0]?.content ?? ""),
							);
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
		return { editor, operations, prompts, requests };
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

	it("only sends a partial selection to the model", async () => {
		const { editor, prompts, requests } = createRewriteEditor("Clearer");
		seedBlocks(editor, [["paragraph", "Before marked after"]]);
		editor.selectTextRange(
			{ blockId: "b1", offset: 7 },
			{ blockId: "b1", offset: 13 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Improve this");

		expect(requests[0]?.documentExcerpts).toEqual([
			{ blockId: "b1", kind: "selection", text: "marked" },
		]);
		expect(prompts[0]).toContain("marked");
		expect(prompts[0]).not.toContain("Before");
		expect(prompts[0]).not.toContain("after");
		editor.destroy();
	});

	it("does not widen a partial selection configured to rewrite as markdown", async () => {
		const { editor, prompts, requests } = createRewriteEditor(
			"Clearer",
			"suggestions",
			defaultSchema,
			{ selectionRewrite: "markdown" },
		);
		seedBlocks(editor, [["paragraph", "Before marked after"]]);
		editor.selectTextRange(
			{ blockId: "b1", offset: 7 },
			{ blockId: "b1", offset: 13 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Improve this");

		expect(requests[0]?.documentExcerpts).toEqual([
			{ blockId: "b1", kind: "selection", text: "marked" },
		]);
		expect(prompts[0]).toContain("marked");
		expect(prompts[0]).not.toContain("Before");
		expect(prompts[0]).not.toContain("after");
		editor.destroy();
	});

	it.each(["suggestions", "direct"] as const)(
		"preserves common marks on a partial selection rewrite (%s)",
		async (mutationPreference) => {
			const { editor, operations } = createRewriteEditor(
				"Clearer",
				mutationPreference,
			);
			seedBlocks(editor, [["paragraph", "Before marked after"]]);
			editor.apply([
				{
					type: "format-text",
					blockId: "b1",
					from: 7,
					to: 13,
					marks: { bold: true, italic: true, underline: true },
				},
			]);
			expect(
				editor
					.getBlock("b1")!
					.textDeltas()
					.find((delta) => delta.insert === "marked")?.attributes,
			).toMatchObject({ bold: true, italic: true, underline: true });
			editor.selectTextRange(
				{ blockId: "b1", offset: 7 },
				{ blockId: "b1", offset: 13 },
			);

			const controller = getAIController(editor)!;
			const session = controller.startSession({
				surface: "inline-edit",
				target: "selection",
			});
			const generation = await controller.runSessionPrompt(
				session.id,
				"Improve this",
			);

			expect(operations[0]?.target.kind).toBe("selection");
			expect(generation.mutationReceipt?.status).toBe(
				mutationPreference === "suggestions"
					? "staged_suggestions"
					: "applied",
			);
			if (mutationPreference === "suggestions") {
				acceptAllSuggestions(editor);
			}
			const replacement = editor
				.getBlock("b1")!
				.textDeltas()
				.find((delta) => delta.insert === "Clearer");
			expect(replacement?.attributes).toMatchObject({
				bold: true,
				italic: true,
				underline: true,
			});
			editor.destroy();
		},
	);

	it("keeps a selection reaching a non-paragraph block on the markdown path", async () => {
		const { editor, operations } = createRewriteEditor("# Shorter title");
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

		expect(operations[0]?.target).toMatchObject({
			kind: "scoped-range",
			blockIds: ["b1"],
		});
		acceptAllSuggestions(editor);
		expect(blockTypes(editor)).toEqual(["heading", "paragraph"]);
		expect(blockTexts(editor)).toEqual(["Shorter title", "Old one."]);
		editor.destroy();
	});

	it("serializes rich selected blocks and ingests the returned markdown", async () => {
		const reply = [
			"**Clearer bold** and *clearer italic* and <u>clearer underline</u>.",
			"\u00a0",
			"- Improved item",
			"![diagram](input-file:attachment-1)",
		].join("\n\n");
		const { editor, operations, prompts, requests } =
			createRewriteEditor(reply);
		seedBlocks(editor, [
			["paragraph", "Bold italic under."],
			["paragraph", "\u00a0"],
			["bulletListItem", "Item", { indent: 0 }],
			["image", "", { src: "input-file:attachment-1", alt: "diagram" }],
			["paragraph", "Kept."],
		]);
		editor.apply([
			{
				type: "format-text",
				blockId: "b1",
				from: 0,
				to: 4,
				marks: { bold: {} },
			},
			{
				type: "format-text",
				blockId: "b1",
				from: 4,
				to: 11,
				marks: { italic: {} },
			},
			{
				type: "format-text",
				blockId: "b1",
				from: 11,
				to: 18,
				marks: { underline: {} },
			},
		]);
		editor.selectTextRange(
			{ blockId: "b1", offset: 0 },
			{ blockId: "b5", offset: 0 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Improve this");

		expect(operations[0]?.target).toMatchObject({
			kind: "scoped-range",
			blockIds: ["b1", "b2", "b3", "b4"],
		});
		expect(prompts[0]).toContain("**Bold**");
		expect(prompts[0]).toContain("* italic*");
		expect(prompts[0]).toContain("<u> under.</u>");
		expect(prompts[0]).toContain("- Item");
		expect(prompts[0]).toContain("![diagram](input-file:attachment-1)");
		expect(requests[0]?.documentExcerpts).toEqual([
			{
				blockId: "b1",
				kind: "selection",
				text: expect.stringContaining(
					"![diagram](input-file:attachment-1)",
				),
			},
		]);

		acceptAllSuggestions(editor);
		expect(blockTypes(editor)).toEqual([
			"paragraph",
			"paragraph",
			"bulletListItem",
			"image",
			"paragraph",
		]);
		expect(blockTexts(editor)).toEqual([
			"Clearer bold and clearer italic and clearer underline.",
			"\u00a0",
			"Improved item",
			"",
			"Kept.",
		]);
		const richDeltas = editor
			.getBlock(editor.documentState.blockOrder[0]!)!
			.textDeltas();
		expect(richDeltas.some((delta) => delta.attributes?.bold != null)).toBe(
			true,
		);
		expect(
			richDeltas.some((delta) => delta.attributes?.italic != null),
		).toBe(true);
		expect(
			richDeltas.some((delta) => delta.attributes?.underline != null),
		).toBe(true);
		const image = editor.getBlock(editor.documentState.blockOrder[3]!);
		expect(image?.props).toMatchObject({
			src: "input-file:attachment-1",
			alt: "diagram",
		});
		editor.destroy();
	});

	it("preserves consecutive empty paragraphs in a whole-block rewrite", async () => {
		const markdown = "Before\n\n\n\n\n\n- After";
		const { editor, prompts } = createRewriteEditor(markdown);
		seedBlocks(editor, [
			["paragraph", "Before"],
			["paragraph", ""],
			["paragraph", ""],
			["bulletListItem", "After"],
		]);
		editor.selectTextRange(
			{ blockId: "b1", offset: 0 },
			{ blockId: "b4", offset: 5 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Improve this");

		expect(prompts[0]).toContain(markdown);
		acceptAllSuggestions(editor);
		expect(blockTexts(editor)).toEqual(["Before", "", "", "After"]);
		expect(blockTypes(editor)).toEqual([
			"paragraph",
			"paragraph",
			"paragraph",
			"bulletListItem",
		]);
		editor.destroy();
	});

	it("ignores trailing host chrome when rewriting selected content blocks", async () => {
		const emailQuote = defineBlock("emailQuote", {
			content: [],
			isContainer: true,
			fieldEditor: "none",
			display: { title: "Quoted message", hidden: true },
			authoring: {
				selectionRole: "structural",
				flowCapability: "flow-structural",
				contentRole: "chrome",
			},
		});
		const { editor, operations } = createRewriteEditor(
			"New introduction\n\n- New item",
			"suggestions",
			defaultSchema.extend([emailQuote]),
		);
		seedBlocks(editor, [
			["paragraph", "Old introduction"],
			["bulletListItem", "Old item"],
		]);
		editor.apply([
			{
				type: "insert-block",
				blockId: "quote",
				blockType: "emailQuote",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "quote-child",
				blockType: "paragraph",
				props: {},
				position: { parent: "quote", index: 0 },
			},
		]);
		expect(editor.getBlock("quote")).not.toBeNull();
		editor.selectTextRange(
			{ blockId: "b1", offset: 0 },
			{ blockId: "quote-child", offset: 0 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Rewrite this");

		expect(operations[0]?.target).toMatchObject({
			kind: "scoped-range",
			contentFormat: "markdown",
			blockIds: ["b1", "b2"],
		});
		editor.destroy();
	});
});

function seedBlocks(
	editor: Editor,
	blocks: readonly (readonly [
		type: string,
		text: string,
		props?: Record<string, unknown>,
	])[],
): void {
	const seedBlockId = editor.firstBlock()!.id;
	editor.apply([
		...blocks.flatMap(([blockType, text, props], index) => {
			const blockId = `b${index + 1}`;
			return [
				{
					type: "insert-block" as const,
					blockId,
					blockType,
					props: props ?? {},
					position: "last" as const,
				},
				...(text.length > 0
					? [
							{
								type: "splice-text" as const,
								blockId,
								from: 0,
								to: 0,
								insert: text,
							},
						]
					: []),
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
