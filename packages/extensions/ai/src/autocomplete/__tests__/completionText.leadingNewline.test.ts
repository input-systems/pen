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

	it("keeps a single leading newline after a line with no closing punctuation", () => {
		const context = createContext({ prefixText: "3" });

		expect(normalizeCompletionText(context, "\n4\n5")).toBe("\n4\n5");
	});

	it("keeps a single leading newline mid-sentence", () => {
		const context = createContext({ prefixText: "Thanks for" });

		expect(normalizeCompletionText(context, "\nyour time")).toBe(
			"\nyour time",
		);
	});

	it.each(["", "  "])(
		"drops a single leading newline in an empty block, where it would only leave a gap (prefix %j)",
		(prefixText) => {
			const context = createContext({ prefixText });

			expect(normalizeCompletionText(context, "\nThanks for")).toBe(
				"Thanks for",
			);
		},
	);

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

describe("normalizeCompletionText escaped newlines", () => {
	it("reads an escaped newline as a line break", () => {
		const context = createContext({ prefixText: "See you " });

		expect(
			normalizeCompletionText(context, "tomorrow.\\n\\nBest,\\nKrijn"),
		).toBe("tomorrow.\n\nBest,\nKrijn");
	});

	it("applies the leading newline rules to an escaped newline", () => {
		const context = createContext({ prefixText: "Best," });

		expect(normalizeCompletionText(context, "\\nKrijn")).toBe("\nKrijn");
		expect(normalizeCompletionText(context, "\\r\\n\\r\\nKrijn")).toBe(
			"\n\nKrijn",
		);
	});

	it("keeps an escaped newline in a code block, where it is source text", () => {
		const context = createContext({
			blockType: "codeBlock",
			prefixText: "const eol = ",
		});

		expect(normalizeCompletionText(context, '"\\n";')).toBe('"\\n";');
	});
});
