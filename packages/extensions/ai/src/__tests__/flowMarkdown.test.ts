import { describe, expect, it } from "vitest";
import {
	buildFlowMarkdownRequestPrompt,
	normalizeFlowMarkdownOutput,
} from "../runtime/flowMarkdown";

describe("buildFlowMarkdownRequestPrompt", () => {
	it("allows every formatting construct preserved by selection rewrites", () => {
		const prompt = buildFlowMarkdownRequestPrompt({
			prompt: "Improve this",
			workingSet: null,
			editsArriveAsToolCalls: false,
		});

		expect(prompt).toContain("task lists");
		expect(prompt).toContain("strikethrough");
		expect(prompt).toContain("inline code");
	});
});

describe("normalizeFlowMarkdownOutput", () => {
	it("keeps consecutive internal blank lines", () => {
		const content = "Before\n\n\n\n\n\nAfter";

		expect(normalizeFlowMarkdownOutput(content)).toBe(content);
	});

	it("keeps whitespace-only blocks at the edges of model output", () => {
		const content = "\u00a0\n\nBody\n\n\u00a0";

		expect(
			normalizeFlowMarkdownOutput(
				` \n<!-- block:b1 paragraph -->\n${content}\n `,
			),
		).toBe(content);
		expect(
			normalizeFlowMarkdownOutput(`\`\`\`markdown\n${content}\n\`\`\``),
		).toBe(content);
	});
});
