import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { undoExtension } from "@input/pen-undo";
import type {
	BlockHandle,
	ModelAdapter,
	ModelStreamEvent,
} from "@input/pen-types";
import { aiExtension, getAIController } from "../index";
import { deltaStreamExtension } from "../stream";
import { Annotation, annotationsFromRequest } from "./editChannel.testHelpers";

const TITLE = "Quarterly Report";
const BODY = "This report covers the third quarter.";

function headingFromRequest(request: {
	messages: unknown;
}): Annotation | undefined {
	return annotationsFromRequest(request).find(
		(annotation) => annotation.type === "heading",
	);
}

function paragraphFromRequest(request: {
	messages: unknown;
}): Annotation | undefined {
	return annotationsFromRequest(request).find(
		(annotation) => annotation.type === "paragraph",
	);
}

function formatTitleModel(): ModelAdapter {
	let passes = 0;
	return {
		async *stream(request) {
			passes += 1;
			if (passes > 1) {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			const heading = headingFromRequest(
				request as { messages: unknown },
			);
			yield {
				type: "tool-call",
				toolCallId: `call-${passes}`,
				toolName: "edit_document",
				input: {
					operations: [
						{
							operation: "format_text",
							blockId: heading!.id,
							marks: { textColor: { color: "purple" } },
						},
					],
				},
			} as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

function convertParagraphModel(): ModelAdapter {
	let passes = 0;
	return {
		async *stream(request) {
			passes += 1;
			if (passes > 1) {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			const paragraph = paragraphFromRequest(
				request as { messages: unknown },
			);
			yield {
				type: "tool-call",
				toolCallId: `call-${passes}`,
				toolName: "edit_document",
				input: {
					operations: [
						{
							operation: "set_block_props",
							blockId: paragraph!.id,
							blockType: "blockquote",
						},
					],
				},
			} as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

function createChatEditor(model: ModelAdapter) {
	return createEditor({
		schema: defaultSchema,
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({
				model,
				contentFormat: { blockGeneration: "markdown" },
				mutationPreference: "suggestions",
				allowedMutatingTools: ["edit_document"],
			}),
		],
	});
}

function seedDocument(editor: ReturnType<typeof createEditor>): {
	headingId: string;
	introId: string;
} {
	const headingId = editor.firstBlock()!.id;
	editor.apply(
		[
			{
				type: "set-props",
				blockId: headingId,
				props: { type: "heading", level: 1 },
			},
			{
				type: "splice-text",
				blockId: headingId,
				from: 0,
				to: 0,
				insert: TITLE,
			},
			{
				type: "insert-block",
				blockId: "intro",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "intro",
				from: 0,
				to: 0,
				insert: BODY,
			},
		],
		{ origin: "system" },
	);
	return { headingId, introId: "intro" };
}

function hasTextColor(block: BlockHandle | null, color: string): boolean {
	if (!block) {
		return false;
	}
	return block.textDeltas().some((delta) => {
		const mark = delta.attributes?.textColor;
		if (!mark || typeof mark !== "object") {
			return false;
		}
		return (mark as { color?: unknown }).color === color;
	});
}

describe("EC11: format_text and set_block_props stage for review", () => {
	it("EC11: format_text stays unapplied until accept and does not write durably while pending", async () => {
		const editor = createChatEditor(formatTitleModel());
		await editor.whenReady();
		const { headingId } = seedDocument(editor);
		const controller = getAIController(editor)!;

		await controller.runPrompt("Make the title purple", {
			target: "document",
		});

		const pending = editor.getBlock(headingId);
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
		expect(pending?.textContent()).toBe(TITLE);
		expect(hasTextColor(pending, "purple")).toBe(false);

		controller.acceptAllSuggestions();
		const accepted = editor.getBlock(headingId);
		expect(controller.getSuggestions()).toHaveLength(0);
		expect(accepted?.textContent()).toBe(TITLE);
		expect(hasTextColor(accepted, "purple")).toBe(true);

		editor.destroy();
	});

	it("EC11: rejecting format_text restores the original marks and text", async () => {
		const editor = createChatEditor(formatTitleModel());
		await editor.whenReady();
		const { headingId } = seedDocument(editor);
		const controller = getAIController(editor)!;
		const originalDeltas = editor.getBlock(headingId)!.textDeltas();

		await controller.runPrompt("Make the title purple", {
			target: "document",
		});
		expect(hasTextColor(editor.getBlock(headingId), "purple")).toBe(false);

		controller.rejectAllSuggestions();
		const rejected = editor.getBlock(headingId);
		expect(controller.getSuggestions()).toHaveLength(0);
		expect(rejected?.textContent()).toBe(TITLE);
		expect(hasTextColor(rejected, "purple")).toBe(false);
		expect(rejected?.textDeltas()).toEqual(originalDeltas);

		editor.destroy();
	});

	it("EC11: set_block_props stays the original type until accept", async () => {
		const editor = createChatEditor(convertParagraphModel());
		await editor.whenReady();
		const { introId } = seedDocument(editor);
		const controller = getAIController(editor)!;

		await controller.runPrompt("Turn the paragraph into a blockquote", {
			target: "document",
		});

		const pending = editor.getBlock(introId);
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
		expect(pending?.id).toBe(introId);
		expect(pending?.type).toBe("paragraph");
		expect(pending?.textContent()).toBe(BODY);

		controller.acceptAllSuggestions();
		const accepted = editor.getBlock(introId);
		expect(controller.getSuggestions()).toHaveLength(0);
		expect(accepted?.id).toBe(introId);
		expect(accepted?.type).toBe("blockquote");
		expect(accepted?.textContent()).toBe(BODY);

		editor.destroy();
	});

	it("EC11: rejecting set_block_props leaves the original type and id", async () => {
		const editor = createChatEditor(convertParagraphModel());
		await editor.whenReady();
		const { introId } = seedDocument(editor);
		const controller = getAIController(editor)!;

		await controller.runPrompt("Turn the paragraph into a blockquote", {
			target: "document",
		});
		expect(editor.getBlock(introId)?.type).toBe("paragraph");

		controller.rejectAllSuggestions();
		const rejected = editor.getBlock(introId);
		expect(controller.getSuggestions()).toHaveLength(0);
		expect(rejected?.id).toBe(introId);
		expect(rejected?.type).toBe("paragraph");
		expect(rejected?.textContent()).toBe(BODY);

		editor.destroy();
	});

	it("EC13: one undo after accepting format_text returns to the pre-turn document", async () => {
		const editor = createChatEditor(formatTitleModel());
		await editor.whenReady();
		const { headingId } = seedDocument(editor);
		const controller = getAIController(editor)!;
		const originalDeltas = editor.getBlock(headingId)!.textDeltas();

		await controller.runPrompt("Make the title purple", {
			target: "document",
		});
		controller.acceptAllSuggestions();
		expect(hasTextColor(editor.getBlock(headingId), "purple")).toBe(true);

		expect(editor.undoManager.undo()).toBe(true);
		const afterUndo = editor.getBlock(headingId);
		expect(afterUndo?.textContent()).toBe(TITLE);
		expect(hasTextColor(afterUndo, "purple")).toBe(false);
		expect(afterUndo?.textDeltas()).toEqual(originalDeltas);

		editor.destroy();
	});

	it("EC13: one undo after accepting set_block_props returns to the pre-turn document", async () => {
		const editor = createChatEditor(convertParagraphModel());
		await editor.whenReady();
		const { introId } = seedDocument(editor);
		const controller = getAIController(editor)!;

		await controller.runPrompt("Turn the paragraph into a blockquote", {
			target: "document",
		});
		controller.acceptAllSuggestions();
		expect(editor.getBlock(introId)?.type).toBe("blockquote");

		expect(editor.undoManager.undo()).toBe(true);
		const afterUndo = editor.getBlock(introId);
		expect(afterUndo?.id).toBe(introId);
		expect(afterUndo?.type).toBe("paragraph");
		expect(afterUndo?.textContent()).toBe(BODY);

		editor.destroy();
	});
});
