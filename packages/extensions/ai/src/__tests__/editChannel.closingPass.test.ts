import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import type { ModelAdapter, ModelStreamEvent } from "@input/pen-types";
import { getAIController } from "../index";
import {
	Annotation,
	annotationsFromRequest,
	createChatEditor,
} from "./editChannel.testHelpers";

function lastParagraphId(annotations: Annotation[]): string {
	const lastParagraph = annotations
		.filter((annotation) => annotation.type === "paragraph")
		.at(-1);
	expect(lastParagraph).toBeTruthy();
	return lastParagraph!.id;
}

function seedDocument(editor: ReturnType<typeof createEditor>): {
	headingId: string;
	lastParagraphId: string;
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
				insert: "Quarterly Report",
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
				insert: "This report covers the third quarter.",
			},
			{
				type: "insert-block",
				blockId: "closing",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "closing",
				from: 0,
				to: 0,
				insert: "Revenue grew. Costs fell. Margins improved.",
			},
		],
		{ origin: "system" },
	);
	return { headingId, lastParagraphId: "closing" };
}

describe("EC14: a finished edit does not wait on a closing pass", () => {
	it("EC14: one succeeding edit_document call resolves the document in one model pass", async () => {
		let passes = 0;
		const adapter: ModelAdapter = {
			async *stream(request) {
				passes += 1;
				yield {
					type: "tool-call",
					toolCallId: `call-${passes}`,
					toolName: "edit_document",
					input: {
						operations: [
							{
								operation: "replace_block_text",
								blockId: lastParagraphId(
									annotationsFromRequest(
										request as { messages: unknown },
									),
								),
								text: "Revenue grew.",
							},
						],
					},
				} as ModelStreamEvent;
				yield { type: "done" } as ModelStreamEvent;
			},
		};
		const editor = createChatEditor(adapter);
		await editor.whenReady();
		const { lastParagraphId: closingId } = seedDocument(editor);
		const before = editor.getBlock(closingId)!.textContent();

		const generation = await getAIController(editor)!.runPrompt(
			"Shorten the closing paragraph.",
			{ target: "document" },
		);

		expect(generation.status).toBe("complete");
		expect(generation.editsArriveAsToolCalls).toBe(true);
		expect(passes).toBe(1);
		expect(editor.getBlock(closingId)?.textContent()).toBe("Revenue grew.");
		expect(editor.getBlock(closingId)?.textContent()).not.toBe(before);

		editor.destroy();
	});

	it("EC14: a read-only pass still loops to a further pass", async () => {
		let passes = 0;
		const adapter: ModelAdapter = {
			async *stream() {
				passes += 1;
				if (passes === 1) {
					yield {
						type: "tool-call",
						toolCallId: "read-1",
						toolName: "read_document",
						input: { format: "summary" },
					} as ModelStreamEvent;
					yield { type: "done" } as ModelStreamEvent;
					return;
				}
				yield { type: "done" } as ModelStreamEvent;
			},
		};
		const editor = createChatEditor(adapter);
		await editor.whenReady();
		seedDocument(editor);

		const generation = await getAIController(editor)!.runPrompt(
			"Read the document first.",
			{ target: "document" },
		);

		expect(generation.status).toBe("complete");
		expect(passes).toBe(2);

		editor.destroy();
	});

	it("EC14: a rejected edit_document call still loops", async () => {
		let passes = 0;
		const adapter: ModelAdapter = {
			async *stream() {
				passes += 1;
				if (passes === 1) {
					yield {
						type: "tool-call",
						toolCallId: "edit-1",
						toolName: "edit_document",
						input: {
							operations: [
								{
									operation: "replace_block_text",
									blockId: "does-not-exist",
									text: "Should not land.",
								},
							],
						},
					} as ModelStreamEvent;
					yield { type: "done" } as ModelStreamEvent;
					return;
				}
				yield { type: "done" } as ModelStreamEvent;
			},
		};
		const editor = createChatEditor(adapter);
		await editor.whenReady();
		const { lastParagraphId: closingId } = seedDocument(editor);
		const before = editor.getBlock(closingId)!.textContent();

		const generation = await getAIController(editor)!.runPrompt(
			"Rewrite a missing block.",
			{ target: "document" },
		);

		expect(generation.status).toBe("complete");
		expect(passes).toBe(2);
		expect(editor.getBlock(closingId)?.textContent()).toBe(before);

		editor.destroy();
	});
});

describe("EC10: refuse-then-correct completes inside one turn", () => {
	it("EC10: a refused unknown id is corrected on the next pass of the same turn", async () => {
		let passes = 0;
		let refusalPayload = "";
		const adapter: ModelAdapter = {
			async *stream(request) {
				passes += 1;
				if (passes === 1) {
					yield {
						type: "tool-call",
						toolCallId: "edit-bad",
						toolName: "edit_document",
						input: {
							operations: [
								{
									operation: "replace_block_text",
									blockId: "does-not-exist",
									text: "Should not land.",
								},
							],
						},
					} as ModelStreamEvent;
					yield { type: "done" } as ModelStreamEvent;
					return;
				}
				refusalPayload = JSON.stringify(
					(request as { messages: unknown }).messages,
				);
				yield {
					type: "tool-call",
					toolCallId: "edit-ok",
					toolName: "edit_document",
					input: {
						operations: [
							{
								operation: "replace_block_text",
								blockId: lastParagraphId(
									annotationsFromRequest(
										request as { messages: unknown },
									),
								),
								text: "Corrected closing.",
							},
						],
					},
				} as ModelStreamEvent;
				yield { type: "done" } as ModelStreamEvent;
			},
		};
		const editor = createChatEditor(adapter);
		await editor.whenReady();
		const { lastParagraphId: closingId } = seedDocument(editor);

		const generation = await getAIController(editor)!.runPrompt(
			"Rewrite the closing paragraph.",
			{ target: "document" },
		);

		expect(generation.status).toBe("complete");
		expect(generation.editsArriveAsToolCalls).toBe(true);
		expect(passes).toBe(2);
		expect(refusalPayload).toContain("unknown-block");
		expect(refusalPayload).toContain("does-not-exist");
		expect(refusalPayload).toContain("outline");
		expect(editor.getBlock(closingId)?.textContent()).toBe(
			"Corrected closing.",
		);

		editor.destroy();
	});
});
