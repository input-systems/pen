import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { undoExtension } from "@input/pen-undo";
import { deltaStreamExtension } from "../stream";
import { toolsExtension } from "@input/pen-tools";
import {
	aiExtension,
	getAIInlineHistoryController,
	getAIController,
} from "../index";
import { defaultSchema } from "@input/pen-schema";
import { createSingleDeltaEditor } from "./extension.testUtils";

describe("aiExtension: inline review restore and session metrics", () => {
	it("does not reopen accepted inline review for unrelated undo operations", async () => {
		const editor = createSingleDeltaEditor("planet");
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: firstBlockId,
					from: 0,
					to: 0,
					insert: "Hello world",
				},
				{
					type: "insert-block",
					blockId: secondBlockId,
					blockType: "paragraph",
					props: {},
					position: "last",
				},
				{
					type: "splice-text",
					blockId: secondBlockId,
					from: 0,
					to: 0,
					insert: "Other block",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId: firstBlockId, offset: 6 },
			{ blockId: firstBlockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();

		await controller.runSessionPrompt(session!.id, "Rewrite the selection");
		const reviewTurnId = controller.getActiveSession()?.turns[0]?.id;
		expect(reviewTurnId).toBeTruthy();
		expect(controller.acceptSessionTurn(session!.id, reviewTurnId!)).toBe(
			true,
		);
		expect(
			controller.getActiveSession()?.contextualPrompt?.composer.isOpen,
		).toBe(false);
		editor.undoManager.stopCapturing();

		editor.selectText(secondBlockId, 11, 11);
		editor.apply(
			[
				{
					type: "splice-text",
					blockId: secondBlockId,
					from: 11,
					to: 11,
					insert: "!",
				},
			],
			{ origin: "user" },
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(secondBlockId)?.textContent()).toBe(
			"Other block",
		);
		expect(controller.getActiveSession()?.id).toBe(session!.id);
		expect(
			controller.getActiveSession()?.contextualPrompt?.composer.isOpen,
		).toBe(false);
		expect(controller.getActiveSession()?.turns[0]?.status).toBe(
			"accepted",
		);
	});

	it("restores the latest inline review turn even when no inline session is active", async () => {
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
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();

		await controller.runSessionPrompt(session!.id, "Rewrite the selection");
		const reviewTurnId = controller.getActiveSession()?.turns[0]?.id;
		expect(reviewTurnId).toBeTruthy();
		expect(controller.acceptSessionTurn(session!.id, reviewTurnId!)).toBe(
			true,
		);
		controller.suspendInlineSession(session!.id);
		expect(controller.getState().activeSessionId).toBeNull();

		expect(editor.undoManager.undo()).toBe(true);

		const restoredSession = controller.getActiveSession();
		expect(restoredSession?.id).toBe(session!.id);
		expect(restoredSession?.contextualPrompt?.composer.isOpen).toBe(true);
		expect(restoredSession?.turns[0]?.status).toBe("review");
	});

	it("restores the inline prompt in the same undo step after accepting a suspended review turn", async () => {
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
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();

		await controller.runSessionPrompt(session!.id, "Rewrite the selection");
		const reviewTurnId = controller.getActiveSession()?.turns[0]?.id;
		expect(reviewTurnId).toBeTruthy();

		controller.suspendInlineSession(session!.id);
		expect(controller.getState().activeSessionId).toBeNull();
		expect(
			controller.getState().sessions[0]?.contextualPrompt?.composer
				.isOpen,
		).toBe(false);

		expect(controller.acceptSessionTurn(session!.id, reviewTurnId!)).toBe(
			true,
		);
		expect(editor.undoManager.undo()).toBe(true);

		const restoredSession = controller.getActiveSession();
		expect(restoredSession?.id).toBe(session!.id);
		expect(restoredSession?.contextualPrompt?.composer.isOpen).toBe(true);
		expect(restoredSession?.contextualPrompt?.composer.draftPrompt).toBe(
			"Rewrite the selection",
		);
		expect(restoredSession?.turns).toHaveLength(1);
		expect(restoredSession?.turns[0]?.status).toBe("review");
	});

	it("restores prompt and review state on the first inline history undo shortcut", async () => {
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
		const inlineHistory = getAIInlineHistoryController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();

		await controller.runSessionPrompt(session!.id, "Rewrite the selection");
		const reviewTurnId = controller.getActiveSession()?.turns[0]?.id;
		expect(reviewTurnId).toBeTruthy();
		expect(controller.acceptSessionTurn(session!.id, reviewTurnId!)).toBe(
			true,
		);

		expect(inlineHistory.canHandleShortcut("undo")).toBe(true);
		expect(inlineHistory.handleShortcut("undo")).toBe(true);

		const restoredSession = controller.getActiveSession();
		expect(restoredSession?.id).toBe(session!.id);
		expect(restoredSession?.contextualPrompt?.composer.isOpen).toBe(true);
		expect(restoredSession?.contextualPrompt?.composer.draftPrompt).toBe(
			"Rewrite the selection",
		);
		expect(restoredSession?.turns).toHaveLength(1);
		expect(restoredSession?.turns[0]?.status).toBe("review");
	});

	it("rewrites text that was previously accepted from AI", async () => {
		let pass = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
							pass += 1;
							yield {
								type: "text-delta" as const,
								delta: pass === 1 ? "planet" : "galaxy",
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
		const firstSession = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(firstSession).not.toBeNull();

		await controller.runSessionPrompt(
			firstSession!.id,
			"Rewrite the selection",
		);
		const firstTurnId = controller.getActiveSession()?.turns[0]?.id;
		expect(firstTurnId).toBeTruthy();
		expect(
			controller.acceptSessionTurn(firstSession!.id, firstTurnId!),
		).toBe(true);
		expect(editor.getBlock(blockId)?.textContent({ resolved: true })).toBe(
			"Hello planet",
		);

		editor.selectTextRange({ blockId, offset: 6 }, { blockId, offset: 12 });
		const secondSession = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(secondSession).not.toBeNull();
		expect(secondSession?.id).not.toBe(firstSession?.id);

		await controller.runSessionPrompt(
			secondSession!.id,
			"Rewrite the selection",
		);
		const secondTurnId = controller.getActiveSession()?.turns.at(-1)?.id;
		expect(secondTurnId).toBeTruthy();
		expect(
			controller.acceptSessionTurn(secondSession!.id, secondTurnId!),
		).toBe(true);
		expect(editor.getBlock(blockId)?.textContent({ resolved: true })).toBe(
			"Hello galaxy",
		);
	});

	it("records selection rewrites in session commit metrics", async () => {
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
		await controller.runSessionPrompt(session.id, "Rewrite the selection");

		expect(controller.getActiveSession()?.metrics.commit).toEqual({
			attemptCount: 1,
			selectionReplacementCount: 1,
			scopedReplacementCount: 0,
			plainMarkdownCount: 0,
			failedCount: 0,
		});
	});

	it("accumulates commit outcome counters across session turns", () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({ contentFormat: { blockGeneration: "markdown" } }),
			],
		});
		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "block",
		});
		const controllerAny = controller as any;

		controllerAny._recordSessionCommitMetrics(session.id, {
			attempted: true,
			succeeded: true,
			executionPath: "selection-replacement",
		});
		controllerAny._recordSessionCommitMetrics(session.id, {
			attempted: true,
			succeeded: true,
			executionPath: "scoped-replacement",
		});
		controllerAny._recordSessionCommitMetrics(session.id, {
			attempted: true,
			succeeded: false,
			executionPath: "plain-markdown",
			fallbackReason: "unparseable-contract",
		});

		expect(controller.getActiveSession()?.metrics.commit).toEqual({
			attemptCount: 3,
			selectionReplacementCount: 1,
			scopedReplacementCount: 1,
			plainMarkdownCount: 1,
			failedCount: 0,
		});
	});
});
