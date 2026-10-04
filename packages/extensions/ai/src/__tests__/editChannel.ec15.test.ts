import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import {
	toolsExtension,
	getDocumentToolRuntime,
} from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { undoExtension } from "@input/pen-undo";
import type { ModelAdapter, ModelStreamEvent } from "@input/pen-types";
import { extractEditDocumentPreview } from "../runtime/editDocumentPreview";
import type { AIStreamingReviewPreview } from "../types";
import { aiExtension, getAIController, runAgenticLoop } from "../index";
import { deltaStreamExtension } from "../stream";
import {
	ORIGINAL,
	annotationsFromRequest,
	seedDocument,
	snapshot,
} from "./editChannel.testHelpers";

const PROMPT = "Shorten the closing paragraph.";
const REWRITE = "Revenue grew.";
const NEW_TITLE = "Q3 Highlights";
const SECOND_INSERT = "Second thought\n\nStill arriving.";

function lastParagraphId(request: { messages: unknown }): string {
	const lastParagraph = annotationsFromRequest(request)
		.filter((annotation) => annotation.type === "paragraph")
		.at(-1);
	expect(lastParagraph).toBeTruthy();
	return lastParagraph!.id;
}

function* emitPartialEditDocument(
	toolCallId: string,
	input: unknown,
): Generator<ModelStreamEvent> {
	const json = JSON.stringify(input);
	yield {
		type: "tool-input-start",
		toolCallId,
		toolName: "edit_document",
	};
	for (let index = 0; index < json.length; index += 16) {
		yield {
			type: "tool-input-delta",
			toolCallId,
			inputTextDelta: json.slice(index, index + 16),
		};
	}
	yield {
		type: "tool-call",
		toolCallId,
		toolName: "edit_document",
		input,
	};
}

function createChatEditor(
	model: ModelAdapter,
	mutationPreference: "direct" | "suggestions" = "direct",
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
				editStreaming: "preview",
				allowedMutatingTools: ["edit_document"],
			}),
		],
	});
}

/**
 * One call, two operations against different blocks: the "edit the title, then
 * extend the end" shape. The first operation's text is complete long before the
 * call closes, which is the case a single-target preview cannot hold.
 */
function twoOperationEditModel(onFragment: () => void): ModelAdapter {
	return {
		capabilities: { partialToolInput: true },
		async *stream(request) {
			if (JSON.stringify(request.messages).includes('"role":"tool"')) {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			const heading = annotationsFromRequest(
				request as { messages: unknown },
			).find((annotation) => annotation.type === "heading");
			expect(heading).toBeTruthy();
			const input = {
				operations: [
					{
						operation: "replace_block_text",
						blockId: heading!.id,
						text: NEW_TITLE,
					},
					{
						operation: "insert_blocks",
						blockId: lastParagraphId(
							request as { messages: unknown },
						),
						placement: "after",
						markdown: SECOND_INSERT,
					},
				],
			};
			const json = JSON.stringify(input);
			yield {
				type: "tool-input-start",
				toolCallId: "edit-two",
				toolName: "edit_document",
			} as ModelStreamEvent;
			for (let index = 0; index < json.length; index += 10) {
				yield {
					type: "tool-input-delta",
					toolCallId: "edit-two",
					inputTextDelta: json.slice(index, index + 10),
				} as ModelStreamEvent;
				onFragment();
			}
			yield {
				type: "tool-call",
				toolCallId: "edit-two",
				toolName: "edit_document",
				input,
			} as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

/** A payload that puts its content before its target, which JSON allows. */
function textBeforeBlockIdModel(onFragment: () => void): ModelAdapter {
	return {
		capabilities: { partialToolInput: true },
		async *stream(request) {
			if (JSON.stringify(request.messages).includes('"role":"tool"')) {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			const json = JSON.stringify({
				operations: [
					{
						operation: "replace_block_text",
						text: REWRITE,
						blockId: "closing",
					},
				],
			});
			yield {
				type: "tool-input-start",
				toolCallId: "edit-late-id",
				toolName: "edit_document",
			} as ModelStreamEvent;
			for (let index = 0; index < json.length; index += 8) {
				yield {
					type: "tool-input-delta",
					toolCallId: "edit-late-id",
					inputTextDelta: json.slice(index, index + 8),
				} as ModelStreamEvent;
				onFragment();
			}
			yield {
				type: "tool-call",
				toolCallId: "edit-late-id",
				toolName: "edit_document",
				input: JSON.parse(json),
			} as ModelStreamEvent;
			yield { type: "done" } as ModelStreamEvent;
		},
	};
}

function streamingRewriteModel(): {
	adapter: ModelAdapter;
} {
	const adapter: ModelAdapter = {
		capabilities: { partialToolInput: true },
		async *stream(request) {
			if (
				JSON.stringify(request.messages).includes('"role":"tool"') ||
				JSON.stringify(request.messages).includes("tool-result")
			) {
				yield { type: "done" } as ModelStreamEvent;
				return;
			}
			const blockId = lastParagraphId(request as { messages: unknown });
			const input = {
				operations: [
					{
						operation: "replace_block_text",
						blockId,
						text: REWRITE,
					},
				],
			};
			yield* emitPartialEditDocument("edit-stream", input);
			yield { type: "done" } as ModelStreamEvent;
		},
	};
	return { adapter };
}

describe("EC15: content in an edit payload streams into the blocks it addresses", () => {
	it("EC15: extracts unterminated operation content from growing JSON", () => {
		const preview = extractEditDocumentPreview(
			'{"operations":[{"operation":"replace_block_text","blockId":"closing","text":"Revenue gr',
			"call-1",
		);
		expect(preview).toEqual({
			toolCallId: "call-1",
			operationIndex: 0,
			blockId: "closing",
			blockIds: ["closing"],
			placement: null,
			operation: "replace_block_text",
			text: "Revenue gr",
			// Plain text, so there is no markdown payload to write from.
			markdown: null,
			// The string has not closed: a short prefix is not yet a short edit.
			complete: false,
		});
	});

	it("EC15: reads the arriving operation, not the first one in the payload", () => {
		const json =
			'{"operations":[{"operation":"replace_block_text","blockId":"title","text":"Q3 Report"},{"operation":"insert_blocks","blockId":"closing","placement":"after","markdown":"## Find';
		expect(extractEditDocumentPreview(json, "call-2")).toEqual({
			toolCallId: "call-2",
			operationIndex: 1,
			blockId: "closing",
			blockIds: ["closing"],
			placement: "after",
			operation: "insert_blocks",
			text: "Find",
			markdown: "## Find",
			complete: false,
		});
	});

	it("EC15: escapes decode, and one that has not finished arriving is held back", () => {
		const preview = (text: string) =>
			extractEditDocumentPreview(
				`{"operations":[{"operation":"replace_block_text","blockId":"closing","text":"${text}`,
				"call-3",
			)?.text;

		expect(preview("Margins improved\\u2014barely")).toBe(
			"Margins improved\u2014barely",
		);
		expect(preview("Costs fell.\\nMargins improved.")).toBe(
			"Costs fell.\nMargins improved.",
		);
		// A half-arrived escape must not be read as its own characters: EC20
		// writes this text, so `\u20` reaching the document as "u20" is a
		// corrupted document, not a cosmetic glitch.
		expect(preview("Margins improved\\u20")).toBe("Margins improved");
		expect(preview("Margins improved\\")).toBe("Margins improved");
	});

	it("EC15: an id or operation name that is still arriving is not read", () => {
		const halfBlockId =
			'{"operations":[{"operation":"replace_block_text","blockId":"clos';
		expect(extractEditDocumentPreview(halfBlockId, "call-1")).toMatchObject(
			{ operation: "replace_block_text", blockId: null },
		);
		// Nothing addressable and nothing to show: not an update at all.
		expect(
			extractEditDocumentPreview(
				'{"operations":[{"operation":"repl',
				"call-1",
			),
		).toBeNull();
	});

	it("EC15: an operation that stopped arriving keeps its preview until the call lands", async () => {
		let editor!: ReturnType<typeof createEditor>;
		const frames: AIStreamingReviewPreview[][] = [];
		const model = twoOperationEditModel(() => {
			frames.push([
				...getAIController(editor)!.getState().streamingReviewPreviews,
			]);
		});
		editor = createChatEditor(model);
		await editor.whenReady();
		seedDocument(editor);
		const headingId = editor.firstBlock()!.id;

		const generation = await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});

		// Frames where the second operation's content is on screen. The first
		// operation's title is complete by then and still unwritten, so it has
		// to be on screen too — a preview that moves to the next operation
		// takes the previous one's proposal off the page, and the block under
		// it reverts to the text the turn is about to replace.
		const whileSecondArrives = frames.filter((previews) =>
			previews.some((preview) => preview.text.includes("Second thought")),
		);
		expect(whileSecondArrives.length).toBeGreaterThan(0);
		for (const previews of whileSecondArrives) {
			expect(
				previews.some(
					(preview) =>
						preview.text === NEW_TITLE &&
						preview.target.kind === "text-range" &&
						preview.target.blockId === headingId,
				),
			).toBe(true);
		}
		expect(generation.status).toBe("complete");
		expect(editor.getBlock(headingId)?.textContent()).toBe(NEW_TITLE);

		editor.destroy();
	});

	it("EC15: text that arrives before its block id previews nowhere", async () => {
		let editor!: ReturnType<typeof createEditor>;
		const frames: AIStreamingReviewPreview[][] = [];
		const model = textBeforeBlockIdModel(() => {
			frames.push([
				...getAIController(editor)!.getState().streamingReviewPreviews,
			]);
		});
		editor = createChatEditor(model);
		await editor.whenReady();
		seedDocument(editor);
		const headingId = editor.firstBlock()!.id;

		const generation = await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});

		// A payload may name its target after its content. Until it does,
		// there is no anchor — and anchoring on the generation's block covers
		// an unrelated block's text with a replacement that was never for it.
		for (const previews of frames) {
			for (const preview of previews) {
				expect(preview.target).toMatchObject({ blockId: "closing" });
			}
		}
		expect(generation.status).toBe("complete");
		expect(editor.getBlock(headingId)?.textContent()).toBe(
			"Quarterly Report",
		);
		expect(editor.getBlock("closing")?.textContent()).toBe(REWRITE);

		editor.destroy();
	});

	it("EC15: partial-input model shows preview content before the payload completes", async () => {
		const { adapter } = streamingRewriteModel();
		const editor = createChatEditor(adapter);
		await editor.whenReady();
		seedDocument(editor);
		const controller = getAIController(editor)!;
		const seen: string[] = [];
		const unsubscribe = controller.subscribe(() => {
			const preview = controller.getState().activeGeneration?.editPreview;
			if (preview?.text) {
				seen.push(preview.text);
			}
		});

		const generation = await controller.runPrompt(PROMPT, {
			target: "document",
		});
		unsubscribe();

		expect(
			seen.some((text) => text.includes("Rev") && text !== REWRITE),
		).toBe(true);
		expect(seen.some((text) => text.includes(REWRITE))).toBe(true);
		expect(generation.status).toBe("complete");
		expect(editor.getBlock("closing")?.textContent()).toBe(REWRITE);

		editor.destroy();
	});

	it("EC15: finished document is byte-identical to the same edit delivered whole", async () => {
		const streamed = streamingRewriteModel();
		const whole: ModelAdapter = {
			async *stream(request) {
				if (JSON.stringify(request.messages).includes("tool-result")) {
					yield { type: "done" } as ModelStreamEvent;
					return;
				}
				const blockId = lastParagraphId(
					request as { messages: unknown },
				);
				yield {
					type: "tool-call",
					toolCallId: "edit-whole",
					toolName: "edit_document",
					input: {
						operations: [
							{
								operation: "replace_block_text",
								blockId,
								text: REWRITE,
							},
						],
					},
				} as ModelStreamEvent;
				yield { type: "done" } as ModelStreamEvent;
			},
		};

		const streamedEditor = createChatEditor(streamed.adapter);
		const wholeEditor = createChatEditor(whole);
		await streamedEditor.whenReady();
		await wholeEditor.whenReady();
		seedDocument(streamedEditor);
		seedDocument(wholeEditor);

		await getAIController(streamedEditor)!.runPrompt(PROMPT, {
			target: "document",
		});
		await getAIController(wholeEditor)!.runPrompt(PROMPT, {
			target: "document",
		});

		expect(
			snapshot(streamedEditor).map(({ type, text }) => ({ type, text })),
		).toEqual(
			snapshot(wholeEditor).map(({ type, text }) => ({ type, text })),
		);
		expect(streamedEditor.getBlock("closing")?.textContent()).toBe(REWRITE);
		expect(wholeEditor.getBlock("closing")?.textContent()).toBe(REWRITE);

		streamedEditor.destroy();
		wholeEditor.destroy();
	});

	it("EC15: abort withdraws the preview and leaves the document byte-identical", async () => {
		const editor = createChatEditor({
			capabilities: { partialToolInput: true },
			async *stream() {
				yield { type: "done" } as ModelStreamEvent;
			},
		});
		await editor.whenReady();
		seedDocument(editor);
		const before = snapshot(editor);
		const abort = new AbortController();
		const toolRuntime = getDocumentToolRuntime(editor)!;
		const seen: string[] = [];

		const generation = await runAgenticLoop({
			model: {
				capabilities: { partialToolInput: true },
				async *stream() {
					yield {
						type: "tool-input-start",
						toolCallId: "edit-abort",
						toolName: "edit_document",
					} as ModelStreamEvent;
					yield {
						type: "tool-input-delta",
						toolCallId: "edit-abort",
						inputTextDelta:
							'{"operations":[{"operation":"replace_block_text","blockId":"closing","text":"Should not land."}]}',
					} as ModelStreamEvent;
					abort.abort();
					yield {
						type: "tool-call",
						toolCallId: "edit-abort",
						toolName: "edit_document",
						input: {
							operations: [
								{
									operation: "replace_block_text",
									blockId: "closing",
									text: "Should not land.",
								},
							],
						},
					} as ModelStreamEvent;
					yield { type: "done" } as ModelStreamEvent;
				},
			},
			editor,
			toolRuntime,
			prompt: PROMPT,
			blockId: "closing",
			editsArriveAsToolCalls: true,
			editStreaming: "preview",
			signal: abort.signal,
			onEditPreview: (preview) => {
				if (preview?.text) {
					seen.push(preview.text);
				}
			},
		});

		expect(seen.length).toBeGreaterThan(0);
		expect(generation.status).toBe("cancelled");
		expect(snapshot(editor)).toEqual(before);
		expect(editor.getBlock("closing")?.textContent()).toBe(ORIGINAL);

		editor.destroy();
	});

	it("EC15: validation failure withdraws the preview and applies nothing", async () => {
		const editor = createChatEditor({
			capabilities: { partialToolInput: true },
			async *stream() {
				const input = {
					operations: [
						{
							operation: "replace_block_text",
							blockId: "does-not-exist",
							text: "Should not land.",
						},
					],
				};
				yield* emitPartialEditDocument("edit-invalid", input);
				yield { type: "done" } as ModelStreamEvent;
			},
		});
		await editor.whenReady();
		seedDocument(editor);
		const before = snapshot(editor);
		const seen: string[] = [];
		const unsubscribe = getAIController(editor)!.subscribe(() => {
			const preview =
				getAIController(editor)!.getState().activeGeneration
					?.editPreview;
			if (preview?.text) {
				seen.push(preview.text);
			}
		});

		const generation = await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});
		unsubscribe();

		expect(seen.length).toBeGreaterThan(0);
		expect(generation.status).toBe("complete");
		expect(snapshot(editor)).toEqual(before);
		expect(generation.editPreview == null).toBe(true);

		editor.destroy();
	});

	it("EC15: stale refusal withdraws the preview and leaves the document byte-identical", async () => {
		let passes = 0;
		const editor = createChatEditor({
			capabilities: { partialToolInput: true },
			async *stream() {
				passes += 1;
				if (passes === 1) {
					const intro = editor.getBlock("closing")!;
					editor.apply(
						[
							{
								type: "splice-text",
								blockId: "closing",
								from: 0,
								to: intro.textContent().length,
								insert: "Concurrent rewrite.",
							},
						],
						{ origin: "system" },
					);
					const input = {
						operations: [
							{
								operation: "replace_block_text",
								blockId: "closing",
								text: "Stale rewrite.",
							},
						],
					};
					yield* emitPartialEditDocument("edit-stale", input);
					yield { type: "done" } as ModelStreamEvent;
					return;
				}
				yield { type: "done" } as ModelStreamEvent;
			},
		});
		await editor.whenReady();
		seedDocument(editor);
		const afterConcurrent = "Concurrent rewrite.";

		const generation = await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});

		expect(generation.status).toBe("complete");
		expect(editor.getBlock("closing")?.textContent()).toBe(afterConcurrent);
		expect(generation.editPreview == null).toBe(true);

		editor.destroy();
	});

	it("EC15: undo after a streamed edit returns to the pre-turn document in one step", async () => {
		const { adapter } = streamingRewriteModel();
		const editor = createChatEditor(adapter);
		await editor.whenReady();
		seedDocument(editor);
		const before = snapshot(editor);

		await getAIController(editor)!.runPrompt(PROMPT, {
			target: "document",
		});
		expect(editor.getBlock("closing")?.textContent()).toBe(REWRITE);

		expect(editor.undoManager.undo()).toBe(true);
		expect(snapshot(editor)).toEqual(before);

		editor.destroy();
	});

	it("EC15: suggestions posture previews in the document like direct does", async () => {
		const seen: string[] = [];
		const editor = createChatEditor(
			{
				capabilities: { partialToolInput: true },
				async *stream(request) {
					if (
						JSON.stringify(request.messages).includes("tool-result")
					) {
						yield { type: "done" } as ModelStreamEvent;
						return;
					}
					const blockId = lastParagraphId(
						request as { messages: unknown },
					);
					yield* emitPartialEditDocument("edit-suggest", {
						operations: [
							{
								operation: "replace_block_text",
								blockId,
								text: REWRITE,
							},
						],
					});
					yield { type: "done" } as ModelStreamEvent;
				},
			},
			"suggestions",
		);
		await editor.whenReady();
		seedDocument(editor);
		const before = snapshot(editor);
		const controller = getAIController(editor)!;
		const unsubscribe = controller.subscribe(() => {
			const preview =
				controller.getState().streamingReviewPreviews[0]?.text;
			if (preview) {
				seen.push(preview);
			}
		});

		const generation = await controller.runPrompt(PROMPT, {
			target: "document",
		});
		unsubscribe();

		// The point of the probe: staging the *landing* does not cost you the
		// preview. A partial arrived, in the document, under `suggestions`.
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.at(-1)!.length).toBeGreaterThan(seen[0]!.length);
		expect(REWRITE.startsWith(seen[0]!)).toBe(true);
		expect(generation.status).toBe("complete");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
		expect(snapshot(editor)).not.toEqual(before);
		expect(
			editor.getBlock("closing")?.textContent({ resolved: true }),
		).toBe(REWRITE);
		controller.rejectAllSuggestions();
		expect(snapshot(editor)).toEqual(before);

		editor.destroy();
	});
});
