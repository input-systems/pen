import type { DocumentOp, Editor } from "@input/pen-types";

/**
 * Applies an input rule as two writes: the character that completed the
 * shorthand, then the rule's rewrite (`- ` → bullet, `**bold**` → bold) as
 * an undo step of its own. Undo right after a rule therefore gives back the
 * literal shorthand, which is how a writer keeps `- ben` as text. Rule ops
 * address the text after the typed character, so it lands first.
 */
export function applyInputRule(
	editor: Editor,
	typed: { blockId: string; offset: number; text: string },
	ops: DocumentOp[],
): void {
	editor.apply(
		[
			{
				type: "splice-text",
				blockId: typed.blockId,
				from: typed.offset,
				to: typed.offset,
				insert: typed.text,
			},
		],
		{ origin: "input-rule" },
	);
	editor.undoManager.stopCapturing();
	editor.apply(ops, { origin: "input-rule" });
	editor.undoManager.stopCapturing();
}
