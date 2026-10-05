import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { undoExtension } from "@input/pen-undo";
import type {
	CommitEvent,
	ModelAdapter,
	ModelStreamEvent,
} from "@input/pen-types";
import { aiExtension, getAIController } from "../index";
import { isAIToolCallDenied } from "../tools";
import { deltaStreamExtension } from "../stream";
import {
	ORIGINAL,
	annotationsFromRequest,
	seedDocument,
	snapshot,
} from "./editChannel.testHelpers";

const PROMPT = "Shorten the last paragraph";

function editChannelModel(): ModelAdapter {
	let passes = 0;
	return {
		async *stream(request) {
			passes += 1;
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
							text: "Revenue grew",
						},
					],
				},
			} as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

function createChatEditor(
	model: ModelAdapter,
	allowedMutatingTools: readonly string[],
) {
	return createEditor({
		schema: defaultSchema,
		extensions: [
			undoExtension(),
			deltaStreamExtension(),
			toolsExtension(),
			aiExtension({
				model,
				contentFormat: { blockGeneration: "markdown" },
				mutationPreference: "direct",
				allowedMutatingTools,
			}),
		],
	});
}

describe("EC13: authority is unchanged on the tool channel", () => {
	it("EC13: edit_document outside the allowlist is a model-visible denial", async () => {
		const editor = createChatEditor(editChannelModel(), []);
		await editor.whenReady();
		const closingId = seedDocument(editor);
		const before = snapshot(editor);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt(PROMPT, {
			target: "document",
		});

		expect(generation.status).not.toBe("error");
		expect(snapshot(editor)).toEqual(before);
		expect(editor.getBlock(closingId)?.textContent()).toBe(ORIGINAL);

		const denied = generation.steps
			.filter((step) => step.type === "tool-call")
			.map((step) => step.output)
			.filter(isAIToolCallDenied);
		expect(denied.length).toBeGreaterThan(0);
		expect(denied[0]).toMatchObject({ ok: false });

		editor.destroy();
	});

	it("EC13: a successful tool-channel edit is one undo group", async () => {
		const editor = createChatEditor(editChannelModel(), ["edit_document"]);
		await editor.whenReady();
		const closingId = seedDocument(editor);
		const before = snapshot(editor);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt(PROMPT, {
			target: "document",
		});

		expect(generation.status).toBe("complete");
		expect(editor.getBlock(closingId)?.textContent()).toBe("Revenue grew");

		expect(editor.undoManager.undo()).toBe(true);
		expect(snapshot(editor)).toEqual(before);
		expect(editor.getBlock(closingId)?.textContent()).toBe(ORIGINAL);

		editor.destroy();
	});

	it("EC13: applied tool-channel ops carry origin ai", async () => {
		const editor = createChatEditor(editChannelModel(), ["edit_document"]);
		await editor.whenReady();
		seedDocument(editor);

		const origins: string[] = [];
		const unsubscribe = editor.on("commit", (event: CommitEvent) => {
			if (event.source === "apply") {
				origins.push(event.origin.type);
			}
		});

		const controller = getAIController(editor)!;
		await controller.runPrompt(PROMPT, { target: "document" });
		unsubscribe();

		expect(origins.length).toBeGreaterThan(0);
		expect(origins.every((type) => type === "ai")).toBe(true);

		editor.destroy();
	});
});
