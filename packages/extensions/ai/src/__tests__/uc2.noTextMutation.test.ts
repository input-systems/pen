import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { undoExtension } from "@input/pen-undo";
import type {
	DiagnosticEvent,
	Editor,
	ModelAdapter,
	ModelStreamEvent,
} from "@input/pen-types";
import { aiExtension, getAIController } from "../index";
import { AI_TOOL_FAILED_CODE } from "../tools/constants";
import { deltaStreamExtension } from "../stream";
import { documentHash } from "./fixtures/documentHash";

/**
 * UC2: a parse- or schema-shaped edit failure is a diagnostic and a
 * refusal, never an edit; assistant text is never compiled into ops
 * (`spec/rules/ai.md` UC2). The well-formed XML-as-text case lives
 * in `agentChat.editChannel.test.ts` and is not repeated here.
 */

const MUST_NOT_LAND = "THIS MUST NOT LAND";

function talkingModel(text: string): ModelAdapter {
	return {
		async *stream() {
			yield { type: "text-delta", delta: text } as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

function malformedEditModel(): ModelAdapter {
	let passes = 0;
	return {
		async *stream() {
			passes += 1;
			if (passes > 1) {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			yield {
				type: "tool-call",
				toolCallId: "call-malformed",
				toolName: "edit_document",
				input: {
					operations: [
						{
							operation: "replace_block_text",
							blockId: "closing",
							text: MUST_NOT_LAND,
							search: "Revenue",
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
				mutationPreference: "direct",
				allowedMutatingTools: ["edit_document"],
			}),
		],
	});
}

function seedDocument(editor: ReturnType<typeof createEditor>): void {
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
}

describe("UC2: no mutation is derived from assistant text, and no failure is an edit", () => {
	it("UC2: a schema-invalid edit_document payload leaves the document unchanged, emits a diagnostic, and does not throw", async () => {
		const editor = createChatEditor(malformedEditModel());
		await editor.whenReady();
		seedDocument(editor);
		const before = documentHash(editor);
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt(
			"Shorten the last paragraph",
			{ target: "document" },
		);

		expect(documentHash(editor)).toBe(before);
		expect(editor.getBlock("closing")?.textContent()).not.toBe(
			MUST_NOT_LAND,
		);
		expect(generation.status).toBe("complete");
		expect(generation.mutationReceipt?.status).toBe("noop");
		expect(
			generation.steps
				.filter((step) => step.toolName === "edit_document")
				.map((step) => JSON.stringify(step.output))
				.join(" "),
		).toMatch(/Unknown field/);
		// The refusal has to reach the host, not just the model. Without this the
		// turn is indistinguishable from a model that declined to edit: document
		// unchanged, no throw, `noop` receipt. The step output above proves the
		// loop knew; this proves it said so.
		const failure = diagnostics.find(
			(event) => event.code === AI_TOOL_FAILED_CODE,
		);
		expect(
			failure?.code ?? "missing",
			`schema-invalid edit_document must emit ${AI_TOOL_FAILED_CODE}; received ${diagnostics
				.map((event) => event.code)
				.join(", ")}`,
		).toBe(AI_TOOL_FAILED_CODE);
		expect(
			failure?.message ?? "",
			"the diagnostic must name the tool and why it was refused",
		).toMatch(/edit_document.*Unknown field/);

		editor.destroy();
	});

	it("UC2: JSON operations sent as assistant text do not become ops", async () => {
		const editor = createChatEditor(
			talkingModel(
				JSON.stringify({
					operations: [
						{
							operation: "replace_block_text",
							blockId: "closing",
							text: MUST_NOT_LAND,
						},
					],
				}),
			),
		);
		await editor.whenReady();
		seedDocument(editor);
		const before = documentHash(editor);

		const generation = await getAIController(editor)!.runPrompt(
			"Shorten the last paragraph",
			{ target: "document" },
		);

		expect(generation.editsArriveAsToolCalls).toBe(true);
		expect(documentHash(editor)).toBe(before);
		expect(generation.mutationReceipt?.status).toBe("noop");

		editor.destroy();
	});
});
