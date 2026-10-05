import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { undoExtension } from "@input/pen-undo";
import { deltaStreamExtension } from "../stream";
import { toolsExtension } from "@input/pen-tools";
import { aiExtension, getAIController } from "../index";
import { defaultSchema } from "@input/pen-schema";
import { createDeferred, createSingleDeltaEditor } from "./extension.testUtils";

describe("aiExtension: tool loop and markdown preview", () => {
	it("keeps selection rewrites text-only when markdown block generation is enabled", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					contentFormat: { blockGeneration: "markdown" },
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "# Planet",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "splice-text",
					blockId,
					from: 0,
					to: 0,
					insert: "Hello world",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange({ blockId, offset: 6 }, { blockId, offset: 11 });

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Rewrite the selection");

		expect(generation.status).toBe("complete");
		expect(generation.contentFormat).toBe("text");
		expect(editor.getBlock(blockId)!.textContent()).toBe(
			"Hello world# Planet",
		);
		expect(editor.documentState.blockOrder).toHaveLength(1);
	});

	it("EC12: rewrite prompts take the tool loop and do not apply assistant text", async () => {
		const editor = createSingleDeltaEditor(" Updated");
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt(
			"Improve this paragraph",
			{ blockId },
		);

		expect(generation.route).toBe("tool-loop");
		expect(generation.editsArriveAsToolCalls).toBe(true);
		expect(editor.getBlock(blockId)!.textContent()).toBe("Hello");
		expect(controller.getSuggestions()).toHaveLength(0);
	});

	it("EC1: bottom-chat document writing does not apply assistant markdown", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
						selectionRewrite: "text",
					},
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "Once upon a time",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "Hello" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Write a short story",
			{ target: "document" },
		);

		expect(generation.route).toBe("tool-loop");
		expect(generation.editsArriveAsToolCalls).toBe(true);
		expect(generation.status).toBe("complete");
		expect(
			editor.documentState.blockOrder
				.map((id) => editor.getBlock(id)?.textContent() ?? "")
				.filter((text) => text.trim().length > 0),
		).toEqual(["Hello"]);
	});

	it("previews bottom-chat markdown on the review surface before staging it", async () => {
		const releaseFinalDelta = createDeferred();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
						selectionRewrite: "text",
					},
					model: {
						async *stream(options) {
							yield {
								type: "replace-preview" as const,
								operation: options.operation!,
								text: "\n\nOnce upon ",
							};
							await releaseFinalDelta.promise;
							yield {
								type: "replace-final" as const,
								operation: options.operation!,
								text: "\n\nOnce upon a time",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		const generationPromise = controller.runSessionPrompt(
			session.id,
			"Write a short story",
			{ target: "document" },
		);

		await new Promise((resolve) => setTimeout(resolve, 80));

		expect(controller.getState().activeGeneration?.surface).toBe(
			"bottom-chat",
		);
		expect(controller.getState().activeGeneration?.contentFormat).toBe(
			"markdown",
		);
		// RS2: an in-flight markdown block generation shows on the review
		// surface and writes nothing, where it used to re-stage the whole
		// parsed payload as suggestions on every frame.
		const visibleStreamingTexts = editor.documentState.blockOrder
			.map(
				(id) =>
					editor.getBlock(id)?.textContent({ resolved: true }) ?? "",
			)
			.filter((text) => text.trim().length > 0);
		expect(
			(
				editor.getBlock(blockId)?.textContent({ resolved: true }) ?? ""
			).replace(/^\u200b/, ""),
		).toBe("");
		expect(visibleStreamingTexts).toEqual([]);
		expect(
			controller
				.getState()
				.streamingReviewPreviews.map((preview) => preview.text),
		).toEqual(["Once upon"]);

		releaseFinalDelta.resolve();
		const generation = await generationPromise;

		expect(generation.status).toBe("complete");
		expect(generation.contentFormat).toBe("markdown");
		expect(generation.text).toBe("\n\nOnce upon a time");
		expect(generation.mutationReceipt?.status).toBe("staged_suggestions");
		expect(generation.suggestionIds?.length ?? 0).toBeGreaterThan(0);
		const visibleFinalTexts = editor.documentState.blockOrder
			.map(
				(id) =>
					editor.getBlock(id)?.textContent({ resolved: true }) ?? "",
			)
			.filter((text) => text.trim().length > 0);
		expect(visibleFinalTexts).toEqual(["Once upon a time"]);
		const turnId = controller
			.getState()
			.sessions.find((item) => item.id === session.id)?.turns[0]?.id;
		expect(controller.acceptSessionTurn(session.id, turnId!)).toBe(true);
		const keptTexts = editor.documentState.blockOrder
			.map(
				(id) =>
					editor.getBlock(id)?.textContent({ resolved: true }) ?? "",
			)
			.filter((text) => text.trim().length > 0);
		expect(keptTexts).toEqual(["Once upon a time"]);
	});

	it("allows inline selection edits after keeping bottom-chat changes", async () => {
		let pass = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
						selectionRewrite: "text",
					},
					model: {
						async *stream(options) {
							pass += 1;
							yield {
								type: "replace-final" as const,
								operation: options.operation!,
								text: pass === 1 ? "Hello world" : "planet",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});

		const controller = getAIController(editor)!;
		const bottomChatSession = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		await controller.runSessionPrompt(
			bottomChatSession.id,
			"Write something in the document",
			{ target: "document" },
		);

		const keptTurnId = controller
			.getSessions()
			.find((session) => session.id === bottomChatSession.id)
			?.turns[0]?.id;
		expect(keptTurnId).toBeTruthy();
		expect(
			controller.acceptSessionTurn(bottomChatSession.id, keptTurnId!),
		).toBe(true);

		const blockId = editor.firstBlock()!.id;
		editor.selectTextRange({ blockId, offset: 6 }, { blockId, offset: 11 });

		const inlineSession = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(inlineSession).not.toBeNull();

		const generation = await controller.runSessionPrompt(
			inlineSession!.id,
			"Rewrite the selection",
			{ target: "selection" },
		);

		expect(generation.target).toBe("selection");
		expect(
			controller
				.getSessions()
				.find((session) => session.id === inlineSession!.id)?.turns,
		).toHaveLength(1);
	});
});
