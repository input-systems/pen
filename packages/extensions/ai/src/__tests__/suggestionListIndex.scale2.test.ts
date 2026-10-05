import type { Editor } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { SuggestionListIndex } from "../suggestions/suggestionListIndex";
import type { PersistentSuggestion } from "../types";

describe("suggestion list index (SCALE2)", () => {
	it("SCALE2: a stored block no array reaches contributes no suggestions, as the full walk", () => {
		// `orphan` is stored but outside the preorder (COL4: a peer deleted its
		// parent) until a local pass re-homes it; `readAllSuggestions` walks
		// the preorder and never reaches it.
		const order = ["a", "b"];
		const editor = {
			documentState: {
				preorderIndexOf: (blockId: string) => order.indexOf(blockId),
			},
		} as unknown as Editor;
		const index = new SuggestionListIndex();
		const store = (blockId: string) =>
			(
				index as unknown as {
					_store(id: string, list: PersistentSuggestion[]): void;
				}
			)._store(blockId, [
				{
					kind: "block",
					id: `s-${blockId}`,
					blockId,
				} as PersistentSuggestion,
			]);
		store("b");
		store("orphan");
		store("a");

		expect(
			index.list(editor).map((suggestion) => suggestion.blockId),
		).toEqual(["a", "b"]);
	});
});
