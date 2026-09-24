import { describe, expect, it } from "vitest";
import { stripBlockAnnotations } from "../utils/documentContext";

describe("stripBlockAnnotations", () => {
	it("handles long internal whitespace runs without backtracking", () => {
		const content = `x${"\t".repeat(40_000)}y`;
		const markdown = `<!-- block:block-1 paragraph -->\n${content}`;
		const start = performance.now();

		expect(stripBlockAnnotations(markdown)).toBe(content);
		expect(performance.now() - start).toBeLessThan(100);
	});
});
