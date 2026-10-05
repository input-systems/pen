import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import { undoExtension } from "@input/pen-undo";
import { deltaStreamExtension } from "../stream";
import { toolsExtension } from "@input/pen-tools";
import { aiExtension, getAIController } from "../index";
import { defaultSchema } from "@input/pen-schema";
import { createSingleDeltaEditor } from "./extension.testUtils";

describe("aiExtension: inline follow-up targets and undo", () => {
	it("refreshes the inline follow-up target after keeping a rewritten selection", async () => {
		let streamCount = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
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
		expect(controller.acceptActiveGeneration()).toBe(true);

		await controller.runSessionPrompt(session.id, "Make it more whimsical");

		const secondOperation = controller
			.getSessions()
			.find((item) => item.id === session.id)?.turns[1]?.operation;
		expect(secondOperation?.kind).toBe("rewrite-selection");
		expect(secondOperation?.target.kind).toBe("selection");
		if (secondOperation?.target.kind !== "selection") {
			throw new Error(
				"Expected selection target for kept inline follow-up",
			);
		}
		expect(secondOperation.target.sourceText).toBe("planet");
		expect(
			secondOperation.target.focus.offset -
				secondOperation.target.anchor.offset,
		).toBeGreaterThanOrEqual("planet".length);
	});

	it("refreshes the inline follow-up target while the prior turn is still in review", async () => {
		let streamCount = 0;
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
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
		expect(
			controller.getSessions().find((item) => item.id === session.id)
				?.turns[0]?.status,
		).toBe("review");

		await controller.runSessionPrompt(session.id, "Make it more whimsical");

		const secondOperation = controller
			.getSessions()
			.find((item) => item.id === session.id)?.turns[1]?.operation;
		expect(secondOperation?.kind).toBe("rewrite-selection");
		expect(secondOperation?.target.kind).toBe("selection");
		if (secondOperation?.target.kind !== "selection") {
			throw new Error(
				"Expected selection target for inline follow-up review",
			);
		}
		expect(secondOperation.target.sourceText).toBe("planet");
		expect(
			secondOperation.target.focus.offset -
				secondOperation.target.anchor.offset,
		).toBeGreaterThanOrEqual("planet".length);
	});

	it("keeps inline prompt targets stable after the live selection changes", async () => {
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

		editor.selectTextRange(
			{ blockId, offset: 11 },
			{ blockId, offset: 11 },
		);

		const originalSelectTextRange = editor.selectTextRange.bind(editor);
		editor.selectTextRange = () => {
			// Simulate a selection target that can no longer be reselected from live state.
		};

		try {
			const generation = await controller.runSessionPrompt(
				session!.id,
				"Rewrite the selection",
			);

			expect(generation.status).toBe("complete");
			expect(generation.target).toBe("selection");
			expect(
				controller.getSessions().find((item) => item.id === session!.id)
					?.turns[0]?.target,
			).toBe("selection");
		} finally {
			editor.selectTextRange = originalSelectTextRange;
		}
	});

	it("restores inline edit review state through document undo and redo", async () => {
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

		const acceptedSession = controller.getActiveSession();
		expect(acceptedSession?.contextualPrompt?.composer.isOpen).toBe(false);
		expect(acceptedSession?.turns[0]?.status).toBe("accepted");
		expect(editor.getBlock(blockId)?.textContent({ resolved: true })).toBe(
			"Hello planet",
		);

		editor.selectTextRange({ blockId, offset: 0 }, { blockId, offset: 0 });
		expect(editor.undoManager.undo()).toBe(true);

		const restoredSession = controller.getActiveSession();
		expect(restoredSession?.id).toBe(session!.id);
		expect(restoredSession?.contextualPrompt?.composer.isOpen).toBe(true);
		expect(restoredSession?.turns).toHaveLength(1);
		expect(restoredSession?.turns[0]?.status).toBe("review");
		expect(
			restoredSession?.turns[0]?.suggestionIds.length ?? 0,
		).toBeGreaterThan(0);

		expect(editor.undoManager.redo()).toBe(true);

		const redoneSession = controller.getActiveSession();
		expect(redoneSession?.id).toBe(session!.id);
		expect(redoneSession?.contextualPrompt?.composer.isOpen).toBe(false);
		expect(redoneSession?.turns[0]?.status).toBe("accepted");
		expect(editor.getBlock(blockId)?.textContent({ resolved: true })).toBe(
			"Hello planet",
		);
	});

	it("lets inline edit continue from an undone review state", async () => {
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
		expect(editor.undoManager.undo()).toBe(true);

		const restoredSession = controller.getActiveSession();
		expect(restoredSession?.contextualPrompt?.composer.isOpen).toBe(true);

		await controller.runSessionPrompt(session!.id, "Try another rewrite");

		const resumedSession = controller.getActiveSession();
		expect(resumedSession?.turns).toHaveLength(2);
		expect(resumedSession?.turns[1]?.prompt).toBe("Try another rewrite");
		expect(resumedSession?.turns[1]?.status).toBe("review");
	});

	it("undoes a streamed inline turn as one step even when deltas span capture timeouts", async () => {
		const editor = createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "pla" };
							await new Promise((resolve) =>
								setTimeout(resolve, 550),
							);
							yield { type: "text-delta" as const, delta: "net" };
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

		expect(editor.undoManager.undo()).toBe(true);
		const restoredReviewSession = controller.getActiveSession();
		expect(restoredReviewSession?.id).toBe(session!.id);
		expect(restoredReviewSession?.contextualPrompt?.composer.isOpen).toBe(
			true,
		);
		expect(restoredReviewSession?.turns).toHaveLength(1);
		expect(restoredReviewSession?.turns[0]?.status).toBe("review");

		expect(editor.undoManager.undo()).toBe(true);
		const restoredPromptSession = controller.getActiveSession();
		expect(restoredPromptSession?.id).toBe(session!.id);
		expect(restoredPromptSession?.contextualPrompt?.composer.isOpen).toBe(
			true,
		);
		expect(restoredPromptSession?.turns).toHaveLength(0);
		expect(
			restoredPromptSession?.contextualPrompt?.composer.draftPrompt,
		).toBe("Rewrite the selection");

		expect(editor.undoManager.redo()).toBe(true);
		const redoneReviewSession = controller.getActiveSession();
		expect(redoneReviewSession?.turns).toHaveLength(1);
		expect(redoneReviewSession?.turns[0]?.status).toBe("review");

		expect(editor.undoManager.redo()).toBe(true);
		const redoneAcceptedSession = controller.getActiveSession();
		expect(redoneAcceptedSession?.turns[0]?.status).toBe("accepted");
	});
});
