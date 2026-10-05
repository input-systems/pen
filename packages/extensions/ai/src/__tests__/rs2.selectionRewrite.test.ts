import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import type { Decoration, Editor, InlineDecoration } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { deltaStreamExtension } from "../stream";
import { aiExtension, getAIController } from "../index";
import { createDeferred, createSingleDeltaEditor } from "./extension.testUtils";

/**
 * RS2 for the selection lane. Staging already went through the suggest
 * transform beforehand; what the one-preview change removed is the bespoke
 * presentation — the ghost overlay standing in for an edit awaiting review.
 * RS1 keeps the ghost for autocomplete, whose job is a keystroke-accepted
 * completion, and gives every proposed edit to the review surface
 * (`spec/rules/ai.md` RS1, RS2).
 */
describe("RS2: selection rewrites ride the review surface", () => {
	it("RS2: a mid-flight selection rewrite previews on the review surface, not the ghost", async () => {
		const releaseDone = createDeferred();
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
								delta: "Rewritten",
							};
							await releaseDone.promise;
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = seedTwoBlocks(editor);
		// A selection spanning blocks cannot stream as an incremental splice,
		// so this is the lane that reached for the ghost overlay.
		editor.selectTextRange(
			{ blockId: firstBlockId, offset: 2 },
			{ blockId: "b2", offset: 3 },
		);

		const controller = getAIController(editor)!;
		const generationPromise = controller.runPrompt("Rewrite it", {
			target: "selection",
		});
		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(controller.getState().ephemeralSuggestion).toBeNull();
		expect(
			controller
				.getState()
				.streamingReviewPreviews.map((preview) => preview.text),
		).toEqual(["Rewritten"]);
		expect(inlineClasses(editor)).not.toContain("pen-ephemeral-suggestion");

		releaseDone.resolve();
		const generation = await generationPromise;

		expect(generation.status).toBe("complete");
		expect(generation.suggestionIds?.length ?? 0).toBeGreaterThan(0);
		// The preview is a posture for an edit in flight; once the edit is
		// staged the decorations carry it (RS3).
		expect(controller.getState().streamingReviewPreviews).toEqual([]);
		editor.destroy();
	});

	it("RS2: a staged selection rewrite renders review-surface decorations", async () => {
		const editor = createSingleDeltaEditor("Rewritten");
		const firstBlockId = seedTwoBlocks(editor);
		editor.selectTextRange(
			{ blockId: firstBlockId, offset: 0 },
			{ blockId: firstBlockId, offset: 5 },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Rewrite it", {
			target: "selection",
		});

		expect(generation.suggestionIds?.length ?? 0).toBeGreaterThan(0);
		const classes = inlineClasses(editor).join(" ");
		expect(classes).toContain("pen-suggestion-insert");
		expect(classes).not.toContain("pen-ephemeral-suggestion");
		editor.destroy();
	});
});

function seedTwoBlocks(editor: Editor): string {
	const firstBlockId = editor.firstBlock()!.id;
	editor.apply([
		{
			type: "insert-block",
			blockId: "b2",
			blockType: "paragraph",
			props: {},
			position: "last",
		},
		{
			type: "splice-text",
			blockId: firstBlockId,
			from: 0,
			to: 0,
			insert: "Hello",
		},
		{ type: "splice-text", blockId: "b2", from: 0, to: 0, insert: "World" },
	]);
	return firstBlockId;
}

function inlineClasses(editor: Editor): string[] {
	return (editor.getDecorations().decorations as readonly Decoration[])
		.filter(
			(decoration): decoration is InlineDecoration =>
				decoration.type === "inline",
		)
		.map((decoration) => String(decoration.attributes.class ?? ""))
		.filter((value) => value.length > 0);
}
