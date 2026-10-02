import { describe, expect, it } from "vitest";
import type { Editor } from "@input/pen-types";
import { normalizeCompletionText } from "../autocompleteCompletionText";
import type { AutocompleteRequestContext } from "../types";

function createContext(
	overrides: Partial<AutocompleteRequestContext>,
): AutocompleteRequestContext {
	return {
		editor: {} as Editor,
		blockId: "b1",
		blockType: "paragraph",
		offset: 0,
		prefixText: "",
		suffixText: "",
		previousBlockText: "",
		nextBlockText: "",
		...overrides,
	};
}

describe("normalizeCompletionText leading newline", () => {
	it("keeps a single leading newline after a sign-off phrase so the name lands in its own block", () => {
		const context = createContext({ prefixText: "Best," });

		expect(normalizeCompletionText(context, "\nKrijn")).toBe("\nKrijn");
	});

	it("keeps a single leading newline after a finished sentence", () => {
		const context = createContext({
			prefixText: "Thanks for your time today.",
		});

		expect(normalizeCompletionText(context, " \nLet me know.")).toBe(
			"\nLet me know.",
		);
	});

	it("drops a single leading newline mid-sentence as a model artifact", () => {
		const context = createContext({ prefixText: "Thanks for" });

		expect(normalizeCompletionText(context, "\nyour time")).toBe(
			" your time",
		);
	});

	it("drops a single leading newline when text follows the caret", () => {
		const context = createContext({
			prefixText: "Best,",
			suffixText: " see you",
		});

		expect(normalizeCompletionText(context, "\nKrijn")).toBe("Krijn");
	});

	it("drops a single leading newline outside prose blocks", () => {
		const context = createContext({
			blockType: "codeBlock",
			prefixText: "return x;",
		});

		expect(normalizeCompletionText(context, "\nfoo()")).toBe("foo()");
	});

	it("still keeps a leading blank line as a spacer", () => {
		const context = createContext({ prefixText: "Thanks for" });

		expect(normalizeCompletionText(context, "\n\nBest,")).toBe("\n\nBest,");
	});
});
