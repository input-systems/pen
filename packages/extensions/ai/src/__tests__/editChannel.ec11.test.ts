import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { undoExtension } from "@input/pen-undo";
import type { ModelAdapter, ModelStreamEvent } from "@input/pen-types";
import type { AIMutationPreference } from "../runtime/contracts";
import { aiExtension, getAIController } from "../index";
import { deltaStreamExtension } from "../stream";

const PROMPT = "Turn the last paragraph into a bullet list";
const BLOCK_ANNOTATION_PATTERN = /<!-- block:(\S+) (\S+) -->/g;

interface Annotation {
	id: string;
	type: string;
}

interface CapturedRequest {
	messages: unknown;
	tools: Array<{ name: string; inputSchema?: unknown }>;
}

function annotationsFromRequest(request: { messages: unknown }): Annotation[] {
	const serialized = JSON.stringify(request.messages);
	return [...serialized.matchAll(BLOCK_ANNOTATION_PATTERN)].map((match) => ({
		id: match[1]!,
		type: match[2]!,
	}));
}

function editDocumentTool(request: CapturedRequest) {
	return request.tools.find((tool) => tool.name === "edit_document");
}

function capturingEditModel(): {
	adapter: ModelAdapter;
	captured: () => CapturedRequest | null;
	passes: () => number;
} {
	let captured: CapturedRequest | null = null;
	let passes = 0;
	const adapter: ModelAdapter = {
		async *stream(request) {
			passes += 1;
			if (passes === 1) {
				captured = {
					messages: request.messages,
					tools: (request.tools ?? []) as CapturedRequest["tools"],
				};
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
							text: "Revenue grew",
						},
					],
				},
			} as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
	return { adapter, captured: () => captured, passes: () => passes };
}

function createChatEditor(
	model: ModelAdapter,
	mutationPreference: AIMutationPreference,
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
				mutationPreference,
				allowedMutatingTools: ["edit_document"],
			}),
		],
	});
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
				insert: "Revenue grew. Costs fell. Margins improved.",
			},
		],
		{ origin: "system" },
	);
	return "closing";
}

describe("EC11: direct vs reviewed is a parameter", () => {
	it("EC11: the same edit_document request lands as ops or suggestions", async () => {
		const directModel = capturingEditModel();
		const suggestionModel = capturingEditModel();
		const original = "Revenue grew. Costs fell. Margins improved.";

		const directEditor = createChatEditor(directModel.adapter, "direct");
		await directEditor.whenReady();
		const directClosing = seedDocument(directEditor);
		const directController = getAIController(directEditor)!;
		const directGeneration = await directController.runPrompt(PROMPT, {
			target: "document",
		});

		const suggestionEditor = createChatEditor(
			suggestionModel.adapter,
			"suggestions",
		);
		await suggestionEditor.whenReady();
		const suggestionClosing = seedDocument(suggestionEditor);
		const suggestionController = getAIController(suggestionEditor)!;
		const suggestionGeneration = await suggestionController.runPrompt(
			PROMPT,
			{ target: "document" },
		);

		const directRequest = directModel.captured();
		const suggestionRequest = suggestionModel.captured();
		expect(directRequest).toBeTruthy();
		expect(suggestionRequest).toBeTruthy();
		const directTool = editDocumentTool(directRequest!);
		const suggestionTool = editDocumentTool(suggestionRequest!);
		expect(directTool?.name).toBe("edit_document");
		expect(suggestionTool?.name).toBe("edit_document");
		expect(suggestionTool?.inputSchema).toEqual(directTool?.inputSchema);
		expect(JSON.stringify(directRequest!.messages)).toContain(PROMPT);
		expect(JSON.stringify(suggestionRequest!.messages)).toContain(PROMPT);

		expect(directGeneration.editsArriveAsToolCalls).toBe(true);
		expect(suggestionGeneration.editsArriveAsToolCalls).toBe(true);
		expect(directGeneration.mutationMode).toBe("direct-stream");
		expect(suggestionGeneration.mutationMode).toBe(
			"persistent-suggestions",
		);
		expect(directModel.passes()).toBe(1);
		expect(suggestionModel.passes()).toBe(1);

		expect(directEditor.getBlock(directClosing)?.textContent()).toBe(
			"Revenue grew",
		);
		expect(directController.getSuggestions()).toHaveLength(0);

		expect(suggestionController.getSuggestions().length).toBeGreaterThan(0);
		expect(
			suggestionEditor
				.getBlock(suggestionClosing)
				?.textContent({ resolved: true }),
		).toBe("Revenue grew");
		suggestionController.rejectAllSuggestions();
		expect(
			suggestionEditor.getBlock(suggestionClosing)?.textContent(),
		).toBe(original);

		directEditor.destroy();
		suggestionEditor.destroy();
	});
});
