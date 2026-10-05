import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { undoExtension } from "@input/pen-undo";
import { deltaStreamExtension } from "../stream";
import { toolsExtension } from "@input/pen-tools";
import { aiExtension, getAIController } from "../index";
import { defaultSchema } from "@input/pen-schema";
import { createDeferred, createSingleDeltaEditor } from "./extension.testUtils";

describe("aiExtension: review fallback and inline sessions", () => {
	it("falls back to document review mode for bottom-chat rewrites on non-text blocks", async () => {
		let requestMode: string | undefined;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
					},
					model: {
						async *stream(options) {
							requestMode = options.requestMode;
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
					insert: "Hello table",
				},
				{
					type: "set-props",
					blockId,
					props: { type: "table" },
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Rewrite this",
		);

		expect(requestMode).toBe("selection-rewrite");
		expect(generation.route).toBe("selection-rewrite");
		expect(generation.mutationReceipt?.status).toBe("noop");
		expect(editor.getBlock(blockId)?.type).toBe("table");
	});

	it("marks local bottom-chat rewrites invalid when target provenance changes", async () => {
		const releaseFinalFrame = createDeferred();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					contentFormat: {
						blockGeneration: "text",
					},
					model: {
						async *stream(options) {
							yield {
								type: "replace-preview" as const,
								operation: options.operation!,
								text: "Hello planet",
							};
							await releaseFinalFrame.promise;
							yield {
								type: "replace-final" as const,
								operation: options.operation!,
								text: "Hello planet",
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
		editor.selectTextRange({ blockId, offset: 5 }, { blockId, offset: 5 });

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
		});
		const generationPromise = controller.runSessionPrompt(
			session.id,
			"Rewrite this",
		);
		for (let tick = 0; tick < 4; tick += 1) {
			await Promise.resolve();
		}
		editor.apply(
			[{ type: "splice-text", blockId, from: 11, to: 11, insert: "!" }],
			{ origin: "user" },
		);
		releaseFinalFrame.resolve();
		const generation = await generationPromise;

		expect(generation.mutationReceipt?.status).toBe("invalid");
		expect(editor.getBlock(blockId)!.textContent({ resolved: true })).toBe(
			"Hello world!",
		);
	});

	it("accepts typed local bottom-chat document rewrites", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					contentFormat: {
						blockGeneration: "text",
					},
					model: {
						async *stream(options) {
							yield {
								type: "replace-final" as const,
								operation: options.operation!,
								text: "# Hello planet",
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
		editor.selectTextRange({ blockId, offset: 5 }, { blockId, offset: 5 });

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Rewrite this",
		);
		expect(generation.status).toBe("complete");
		expect(generation.mutationReceipt?.status).toBe("staged_suggestions");
	});

	it("streams selection rewrites into persistent suggestions before completion", async () => {
		const releaseSecondDelta = createDeferred();
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "plan",
							};
							await releaseSecondDelta.promise;
							yield { type: "text-delta" as const, delta: "et" };
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
		const generationPromise = controller.runPrompt("Rewrite the selection");
		for (let tick = 0; tick < 6; tick += 1) {
			await Promise.resolve();
		}

		expect(controller.getState().ephemeralSuggestion).toBeNull();
		expect(editor.getBlock(blockId)!.textContent()).toBe("Hello worldplan");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);

		releaseSecondDelta.resolve();
		const generation = await generationPromise;

		expect(generation.status).toBe("complete");
		expect(editor.getBlock(blockId)!.textContent()).toBe(
			"Hello worldplanet",
		);
	});

	it("tracks session prompts and accepts session suggestions together", async () => {
		const editor = createSingleDeltaEditor("planet");
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
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Rewrite the selection",
		);
		const nextSession = controller.getActiveSession();

		expect(generation.sessionId).toBe(session.id);
		expect(nextSession?.promptHistory).toHaveLength(1);
		expect(nextSession?.turns).toHaveLength(1);
		expect(nextSession?.turns[0]?.generationId).toBe(generation.id);
		expect(nextSession?.turns[0]?.status).toBe("review");
		expect(nextSession?.generationIds).toContain(generation.id);
		expect(nextSession?.pendingSuggestionIds.length).toBeGreaterThan(0);
		expect(
			controller.acceptSessionTurn(session.id, nextSession!.turns[0]!.id),
		).toBe(true);
		expect(editor.getBlock(blockId)!.textContent({ resolved: true })).toBe(
			"Hello planet",
		);
	});

	it("includes prior inline prompts when continuing the same inline edit session", async () => {
		const capturedPrompts: string[] = [];
		let streamCount = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream(options) {
							capturedPrompts.push(
								String(options.messages[0]?.content ?? ""),
							);
							streamCount += 1;
							yield {
								type: "text-delta" as const,
								delta: streamCount === 1 ? "planet" : "forest",
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
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});

		await controller.runSessionPrompt(session.id, "Rewrite the selection");
		const firstTurnId =
			controller.getSessions().find((item) => item.id === session.id)
				?.turns[0]?.id ?? null;
		expect(firstTurnId).toBeTruthy();
		expect(controller.acceptSessionTurn(session.id, firstTurnId!)).toBe(
			true,
		);

		editor.selectTextRange({ blockId, offset: 6 }, { blockId, offset: 12 });
		await controller.runSessionPrompt(session.id, "Make it more whimsical");

		expect(capturedPrompts[1]).toContain(
			"You are continuing an existing inline editor edit session.",
		);
		expect(capturedPrompts[1]).toContain(
			"Earlier user requests in this same session:",
		);
		expect(capturedPrompts[1]).toContain("1. Rewrite the selection");
		expect(capturedPrompts[1]).toContain(
			"Latest request:\nMake it more whimsical",
		);
	});

	it("refreshes the inline follow-up target after accepting a rewritten selection", async () => {
		let streamCount = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream(options) {
							streamCount += 1;
							yield {
								type: "text-delta" as const,
								delta: streamCount === 1 ? "planet" : "galaxy",
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
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});

		await controller.runSessionPrompt(session.id, "Rewrite the selection");
		const firstTurnId =
			controller.getSessions().find((item) => item.id === session.id)
				?.turns[0]?.id ?? null;
		expect(firstTurnId).toBeTruthy();
		expect(controller.acceptSessionTurn(session.id, firstTurnId!)).toBe(
			true,
		);

		await controller.runSessionPrompt(session.id, "Make it more whimsical");

		const secondOperation = controller
			.getSessions()
			.find((item) => item.id === session.id)?.turns[1]?.operation;
		expect(secondOperation?.kind).toBe("rewrite-selection");
		expect(secondOperation?.target.kind).toBe("selection");
		if (secondOperation?.target.kind !== "selection") {
			throw new Error("Expected selection target for inline follow-up");
		}
		expect(secondOperation.target.sourceText).toBe("planet");
		expect(
			secondOperation.target.focus.offset -
				secondOperation.target.anchor.offset,
		).toBeGreaterThanOrEqual("planet".length);
	});
});
