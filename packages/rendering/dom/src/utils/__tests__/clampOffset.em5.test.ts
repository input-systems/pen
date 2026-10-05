import { describe, expect, it } from "vitest";
import { clampOffset } from "../clampOffset";

const STORAGE_SAMPLES = [
	"",
	"​",
	"​​",
	"a​b",
	"hello",
	" ",
	"hi 👍",
	"日本語",
] as const;

describe("clampOffset EM5", () => {
	it("EM5: DOM offsets are identity clamps over the stored UTF-16 length", () => {
		for (const text of STORAGE_SAMPLES) {
			for (let offset = 0; offset <= text.length; offset++) {
				expect(clampOffset(offset, text.length)).toBe(offset);
			}
			expect(clampOffset(-1, text.length)).toBe(0);
			expect(clampOffset(text.length + 10, text.length)).toBe(
				text.length,
			);
		}
	});
});
