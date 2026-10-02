import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import { describe, expect, it } from "vitest";
import { buildSuggestionScope } from "../scopeBuilder";
import type { DirtyBlockState } from "../scheduler";

function createDirtyBlock(
	blockId: string,
	lastChangedOffset: number,
): DirtyBlockState {
	return {
		blockId,
		firstChangedAt: 0,
		lastChangedAt: 0,
		changeCount: 1,
		changedCharsEstimate: 40,
		lastChangedOffset,
	};
}

describe("buildSuggestionScope", () => {
	it("clips to the edited sentence by default", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		const text = "Thx voor het deln. Interessante locatie.";
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: text }],
			{ origin: "user" },
		);

		const scope = buildSuggestionScope(
			editor,
			createDirtyBlock(blockId, text.length),
		);

		expect(scope?.scope.text).toBe("Interessante locatie.");
		editor.destroy();
	});

	it("analyzes the whole block when scopeUnit is block", () => {
		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		const text = "Thx voor het deln. Interessante locatie.";
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: text }],
			{ origin: "user" },
		);

		const scope = buildSuggestionScope(
			editor,
			createDirtyBlock(blockId, text.length),
			{ scopeUnit: "block" },
		);

		expect(scope?.scope.text).toBe(text);
		expect(scope?.scope.from).toBe(0);
		editor.destroy();
	});
});
