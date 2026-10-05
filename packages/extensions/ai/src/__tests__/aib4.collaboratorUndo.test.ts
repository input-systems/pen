import { readFileSync } from "node:fs";
import path from "node:path";
import { createTwoPeerHarness } from "@input/pen-test";
import type { Editor } from "@input/pen-types";
import { undoExtension } from "@input/pen-undo";
import { describe, expect, it } from "vitest";

/**
 * The multiplayer README's "Undo with collaborators" worked example
 * (W5.R12, AIB4): an AI rewrite is one undo step on Ada's client, Bob's
 * concurrent typing inside it survives Ada's undo, and Bob's own stack is
 * untouched. The README quotes the resulting text; this test reads it.
 */

const AI = { type: "ai" as const, groupId: "rewrite-1" };
const BLOCK = "p1";
const README = path.resolve(
	import.meta.dirname,
	"../../../multiplayer/README.md",
);

function text(editor: Editor): string {
	return editor.getBlock(BLOCK)?.textContent() ?? "";
}

/** The fenced `text` blocks under the README's "Undo with collaborators" section, in order. */
function readmeResults(): string[] {
	const readme = readFileSync(README, "utf8");
	const start = readme.indexOf("## Undo with collaborators");
	expect(start, "the README has an 'Undo with collaborators' section").toBeGreaterThan(-1);
	const end = readme.indexOf("\n## ", start + 1);
	const section = readme.slice(start, end === -1 ? undefined : end);
	return [...section.matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) => match[1]!);
}

describe("@input/pen-ai AIB4 with a collaborator", () => {
	it("AIB4 COL1: undo reverts only Ada's AI rewrite, keeps Bob's concurrent typing, and leaves Bob's stack alone", () => {
		const harness = createTwoPeerHarness({
			blocks: [{ id: BLOCK, type: "paragraph", content: "Hello world" }],
			extensions: [undoExtension({ groupTimeout: 10_000 })],
		});
		const ada = harness.peerA.editor;
		const bob = harness.peerB.editor;

		// 1. Ada's AI run rewrites "world" as "AlphaBeta", in two writes of one group.
		ada.apply(
			[{ type: "splice-text", blockId: BLOCK, from: 6, to: 11, insert: "Alpha" }],
			{ origin: AI },
		);
		ada.apply(
			[{ type: "splice-text", blockId: BLOCK, from: 11, to: 11, insert: "Beta" }],
			{ origin: AI },
		);
		harness.exchange("a-then-b");
		expect(text(bob)).toBe("Hello AlphaBeta");

		// 2. Bob types "XX" between "Alpha" and "Beta".
		bob.apply(
			[{ type: "splice-text", blockId: BLOCK, from: 11, to: 11, insert: "XX" }],
			{ origin: "user" },
		);
		harness.exchange("b-then-a");
		expect(text(ada)).toBe("Hello AlphaXXBeta");

		// 3–4. One undo on Ada's client reverts the whole AI step and nothing of Bob's.
		expect(ada.undoManager.undo()).toBe(true);
		harness.exchange("a-then-b");

		// 5. Both clients converge on the README's quoted result.
		const [afterUndo, afterBobUndo] = readmeResults();
		expect(text(ada)).toBe(afterUndo);
		expect(text(bob)).toBe(afterUndo);
		expect(ada.undoManager.canUndo()).toBe(false);

		// 6. Bob's stack is untouched: his undo still removes "XX".
		expect(bob.undoManager.undo()).toBe(true);
		harness.exchange("b-then-a");
		expect(text(bob)).toBe(afterBobUndo);
		expect(text(ada)).toBe(afterBobUndo);

		harness.destroy();
	});
});
