import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";

import { readAllSuggestions } from "../../suggestions/persistent";
import {
	applyAIOpsForBoundMutationMode,
	bindAIToolMutationMode,
} from "../execution";

let editor: Editor | null = null;

afterEach(() => {
	editor?.destroy();
	editor = null;
});

function createParagraphEditor(): Editor {
	editor = createEditor({ schema: defaultSchema });
	return editor;
}

/** Writes "x" at the start of the first block through the bound mode; true when it staged. */
function writeStages(live: Editor): boolean {
	const before = readAllSuggestions(live).length;
	const blockId = live.firstBlock()!.id;
	applyAIOpsForBoundMutationMode(
		live,
		[{ type: "splice-text", blockId, from: 0, to: 0, insert: "x" }],
		{ origin: "ai" },
	);
	return readAllSuggestions(live).length > before;
}

describe("AIB3 per-generation mutation mode binding", () => {
	it("AIB3: unbinding an earlier generation after a later one bound keeps the later binding", () => {
		const live = createParagraphEditor();
		const unbindA = bindAIToolMutationMode(live, "direct-stream");
		const unbindB = bindAIToolMutationMode(live, "staged-review");

		// A is cancelled while B is still running.
		unbindA();
		expect(writeStages(live)).toBe(true);

		unbindB();
		expect(writeStages(live)).toBe(false);
	});

	it("AIB3: a later generation unbinding first leaves the earlier binding in force", () => {
		const live = createParagraphEditor();
		const unbindA = bindAIToolMutationMode(live, "staged-review");
		const unbindB = bindAIToolMutationMode(live, "direct-stream");

		unbindB();
		expect(writeStages(live)).toBe(true);

		unbindA();
		expect(writeStages(live)).toBe(false);
	});

	it("AIB3: unbinding twice does not drop another generation's binding", () => {
		const live = createParagraphEditor();
		const unbindA = bindAIToolMutationMode(live, "direct-stream");
		unbindA();
		const unbindB = bindAIToolMutationMode(live, "staged-review");
		unbindA();
		expect(writeStages(live)).toBe(true);
		unbindB();
	});
});
