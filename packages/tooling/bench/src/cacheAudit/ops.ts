import { applySplitBlock } from "@input/pen-core";
import { mixedBlockId, mixedFixtureTargets, type TestEditor } from "@input/pen-test";
import type { DocumentOp } from "@input/pen-types";

/** The operations each cache is measured on. */
export const AUDIT_OPS = [
	"keystroke",
	"caret-move",
	"insert-block",
	"move-block",
	"delete-block",
	"split",
] as const;

export type AuditOp = (typeof AUDIT_OPS)[number];

/** Keystrokes and caret moves are held to the per-input budget, the rest to the structural one. */
export function isStructuralOp(op: AuditOp): boolean {
	return op !== "keystroke" && op !== "caret-move";
}

export interface AuditOpRunner {
	run(op: AuditOp): void;
	/** Puts a collapsed caret at the end of the keystroke target. */
	resetCaret(): void;
	/** Removes the typed text and the split blocks, so every cache starts from the same document. */
	cleanup(): void;
}

/**
 * Repeatable operations on the mixed fixture's middle targets. `insert-block`
 * pushes the block `delete-block` later removes, so a measurement that runs
 * every insert before the deletes leaves the document as it found it;
 * `move-block` moves the middle item of a numbered run out and back.
 */
export function createAuditOps(editor: TestEditor, rootCount: number): AuditOpRunner {
	const targets = mixedFixtureTargets(rootCount);
	const numberedIndex = Number(targets.numbered.slice(targets.numbered.lastIndexOf("-") + 1));
	const numberedHome = mixedBlockId(numberedIndex - 1);
	const inserted: string[] = [];
	const splits: string[] = [];
	let serial = 0;
	let caretLeft = true;
	let movedOut = false;

	const textLength = (blockId: string) => editor.getBlock(blockId)?.textContent().length ?? 0;

	const typedFrom = textLength(targets.paragraph);
	const splitFrom = textLength(targets.nextParagraph);

	const cleanup = () => {
		const ops: DocumentOp[] = splits.splice(0).map((blockId) => ({ type: "delete-block", blockId }));
		const typedTo = textLength(targets.paragraph);
		if (typedTo > typedFrom) {
			ops.push({ type: "splice-text", blockId: targets.paragraph, from: typedFrom, to: typedTo, insert: "" });
		}
		if (textLength(targets.nextParagraph) !== splitFrom) {
			throw new Error("cache audit: a split at the end changed the split block's text");
		}
		if (ops.length > 0) editor.apply(ops, { origin: "system" });
	};

	const resetCaret = () => {
		editor.selectText(targets.paragraph, textLength(targets.paragraph), textLength(targets.paragraph));
		caretLeft = true;
	};

	const run = (op: AuditOp): void => {
		switch (op) {
			case "keystroke": {
				const at = textLength(targets.paragraph);
				editor.apply([{ type: "splice-text", blockId: targets.paragraph, from: at, to: at, insert: "x" }], {
					origin: "user",
				});
				editor.selectText(targets.paragraph, at + 1, at + 1);
				return;
			}
			case "caret-move": {
				const selection = editor.selection;
				const at = selection?.type === "text" ? selection.anchor.offset : textLength(targets.paragraph);
				const next = caretLeft ? at - 1 : at + 1;
				caretLeft = !caretLeft;
				editor.selectText(targets.paragraph, next, next);
				return;
			}
			case "insert-block": {
				serial += 1;
				const blockId = `audit-insert-${serial}`;
				inserted.push(blockId);
				editor.apply(
					[
						{
							type: "insert-block",
							blockId,
							blockType: "paragraph",
							props: {},
							position: { after: targets.insertAfter },
						},
					],
					{ origin: "user" },
				);
				return;
			}
			case "delete-block": {
				const blockId = inserted.pop();
				if (!blockId) throw new Error("cache audit: delete-block ran before insert-block");
				editor.apply([{ type: "delete-block", blockId }], { origin: "user" });
				return;
			}
			case "move-block": {
				const after = movedOut ? numberedHome : targets.paragraph;
				movedOut = !movedOut;
				editor.apply([{ type: "move-block", blockId: targets.numbered, position: { after } }], {
					origin: "user",
				});
				return;
			}
			case "split": {
				serial += 1;
				const newBlockId = `audit-split-${serial}`;
				splits.push(newBlockId);
				applySplitBlock(editor, {
					blockId: targets.nextParagraph,
					offset: textLength(targets.nextParagraph),
					newBlockId,
					applyOptions: { origin: "user" },
				});
				return;
			}
			default: {
				const unhandled: never = op;
				return unhandled;
			}
		}
	};

	return { run, resetCaret, cleanup };
}
