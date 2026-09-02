import { describe, expect, it } from "vitest";
import { createEditor } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { toolsExtension } from "@input/pen-tools";
import { defaultSchema } from "@input/pen-schema";
import { deltaStreamExtension } from "../stream";
import { aiExtension, getAIController } from "../index";

/**
 * A block-scoped rewrite replaces the paragraphs it was given, so the blocks the
 * turn was anchored to are gone by the time it settles. Session, turn, and
 * contextual prompt have to re-anchor onto the paragraphs the reply landed as,
 * or a host that positions its prompt UI from that anchor loses the block and
 * falls back to wherever its own fallback points.
 */
describe("inline-edit: a block-scoped rewrite re-anchors on what it wrote", () => {
	function createRewriteEditor(reply: string) {
		return createEditor({
			schema: defaultSchema,
			extensions: [
				undoExtension(),
				deltaStreamExtension(),
				toolsExtension(),
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: reply };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
	}

	async function rewriteWholeParagraph(editor: Editor) {
		editor.selectTextRange(
			{ blockId: "b1", offset: 0 },
			{ blockId: "b1", offset: "Old one.".length },
		);
		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Expand this");
		return {
			controller,
			readSession: () =>
				controller
					.getSessions()
					.find((item) => item.id === session.id)!,
			accept: () => controller.acceptSession(session.id),
		};
	}

	it("anchors the turn under review on the first staged paragraph", async () => {
		const editor = createRewriteEditor("New one.\n\nNew two.");
		seedParagraphs(editor, ["Old one."]);

		const { readSession } = await rewriteWholeParagraph(editor);

		const turn = readSession().turns.at(-1);
		expect(turn?.status).toBe("review");
		expect(blockText(editor, turn?.anchor?.blockId)).toBe("New one.");
	});

	it("keeps the accepted anchor on a live paragraph", async () => {
		const editor = createRewriteEditor("New one.\n\nNew two.");
		seedParagraphs(editor, ["Old one."]);

		const { readSession, accept } = await rewriteWholeParagraph(editor);
		expect(accept()).toBe(true);

		expect(blockTexts(editor)).toEqual(["New one.", "New two."]);
		const session = readSession();
		const focusBlockId = session.contextualPrompt?.anchor.focusBlockId;
		expect(blockText(editor, focusBlockId)).toBe("New one.");
		expect(session.anchor?.blockId).toBe(focusBlockId);
		expect(session.turns.at(-1)?.anchor?.blockId).toBe(focusBlockId);
	});

	it("leaves a selection target anchored on the block it spliced", async () => {
		const editor = createRewriteEditor("New one.");
		seedParagraphs(editor, ["Old one. Keep tail."]);

		const { readSession, accept } = await rewriteWholeParagraph(editor);
		expect(accept()).toBe(true);

		expect(readSession().contextualPrompt?.anchor.focusBlockId).toBe("b1");
	});
});

function seedParagraphs(editor: Editor, texts: readonly string[]): void {
	const seedBlockId = editor.firstBlock()!.id;
	editor.apply([
		...texts.flatMap((text, index) => {
			const blockId = `b${index + 1}`;
			return [
				{
					type: "insert-block" as const,
					blockId,
					blockType: "paragraph",
					props: {},
					position: "last" as const,
				},
				{
					type: "splice-text" as const,
					blockId,
					from: 0,
					to: 0,
					insert: text,
				},
			];
		}),
		{ type: "delete-block" as const, blockId: seedBlockId },
	]);
}

function blockText(
	editor: Editor,
	blockId: string | null | undefined,
): string | undefined {
	return blockId ? editor.getBlock(blockId)?.textContent() : undefined;
}

function blockTexts(editor: Editor): string[] {
	return editor.documentState.blockOrder.map(
		(blockId) => editor.getBlock(blockId)?.textContent() ?? "",
	);
}
