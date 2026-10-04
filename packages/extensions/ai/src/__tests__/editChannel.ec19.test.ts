import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import type { ModelAdapter, ModelStreamEvent } from "@input/pen-types";
import { getAIController } from "../index";
import {
	ORIGINAL,
	PROMPT,
	annotationsFromRequest,
	createChatEditor,
} from "./editChannel.testHelpers";
const REWRITE = "Revenue grew";

function editChannelModel(options?: {
	beforeFirstYield?: () => Promise<void>;
	onStreamEnter?: () => void;
}): ModelAdapter {
	let passes = 0;
	return {
		async *stream(request) {
			passes += 1;
			options?.onStreamEnter?.();
			if (options?.beforeFirstYield && passes === 1) {
				await options.beforeFirstYield();
			}
			if (passes > 1) {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			const lastParagraph = annotationsFromRequest(
				request as { messages: unknown },
			)
				.filter((annotation) => annotation.type === "paragraph")
				.at(-1);
			yield {
				type: "tool-call",
				toolCallId: `call-${passes}`,
				toolName: "edit_document",
				input: {
					operations: [
						{
							operation: "replace_block_text",
							blockId: lastParagraph!.id,
							text: REWRITE,
						},
					],
				},
			} as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

function seedDocument(editor: ReturnType<typeof createEditor>): string {
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
				insert: ORIGINAL,
			},
		],
		{ origin: "system" },
	);
	return "closing";
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});
	}
	throw new Error(
		"Timed out waiting for generation to enter the model stream",
	);
}

describe("EC19: the review posture is a live setting", () => {
	it("EC19: the next turn stages after setMutationPreference(suggestions)", async () => {
		const editor = createChatEditor(editChannelModel());
		await editor.whenReady();
		const closingId = seedDocument(editor);
		const controller = getAIController(editor)!;

		expect(controller.getState().mutationPreference).toBe("direct");
		controller.setMutationPreference("suggestions");
		expect(controller.getState().mutationPreference).toBe("suggestions");

		const generation = await controller.runPrompt(PROMPT, {
			target: "document",
		});

		expect(generation.mutationMode).toBe("persistent-suggestions");
		expect(generation.mutationReceipt?.status).toBe("staged_suggestions");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
		expect(
			editor.getBlock(closingId)?.textContent({ resolved: true }),
		).toBe(REWRITE);

		controller.acceptAllSuggestions();
		expect(editor.getBlock(closingId)?.textContent()).toBe(REWRITE);
		expect(controller.getSuggestions()).toHaveLength(0);

		editor.destroy();
	});

	it("EC19: a turn already in flight resolves under its starting preference", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let enteredStream = false;
		const editor = createChatEditor(
			editChannelModel({
				onStreamEnter: () => {
					enteredStream = true;
				},
				beforeFirstYield: () => gate,
			}),
		);
		await editor.whenReady();
		const closingId = seedDocument(editor);
		const controller = getAIController(editor)!;

		const generationPromise = controller.runPrompt(PROMPT, {
			target: "document",
		});
		await waitUntil(() => enteredStream);
		controller.setMutationPreference("suggestions");
		expect(controller.getState().mutationPreference).toBe("suggestions");
		release();

		const generation = await generationPromise;
		expect(generation.mutationMode).toBe("direct-stream");
		expect(controller.getSuggestions()).toHaveLength(0);
		expect(editor.getBlock(closingId)?.textContent()).toBe(REWRITE);

		editor.destroy();
	});

	it("EC19: staged suggestions survive a switch back to direct until resolved", async () => {
		const editor = createChatEditor(editChannelModel());
		await editor.whenReady();
		const closingId = seedDocument(editor);
		const controller = getAIController(editor)!;
		controller.setMutationPreference("suggestions");

		await controller.runPrompt(PROMPT, { target: "document" });
		expect(controller.getSuggestions().length).toBeGreaterThan(0);

		controller.setMutationPreference("direct");
		expect(controller.getState().mutationPreference).toBe("direct");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
		expect(
			editor.getBlock(closingId)?.textContent({ resolved: true }),
		).toBe(REWRITE);

		controller.rejectAllSuggestions();
		expect(controller.getSuggestions()).toHaveLength(0);
		expect(editor.getBlock(closingId)?.textContent()).toBe(ORIGINAL);

		editor.destroy();
	});
});
