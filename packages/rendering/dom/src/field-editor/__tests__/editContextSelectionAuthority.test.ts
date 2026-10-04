import { describe, expect, it } from "vitest";
import {
	resolveEditContextKeyDownRange,
	resolveEditContextTextUpdateRange,
} from "../editContextSelectionAuthority";

describe("resolveEditContextTextUpdateRange", () => {
	it("inserts at the authority caret when the live update range is stale", () => {
		const result = resolveEditContextTextUpdateRange({
			blockId: "p1",
			updateRangeStart: 11,
			updateRangeEnd: 11,
			text: "!",
			isLogicallyEmpty: false,
			authority: { start: 3, end: 3 },
			trustedCaret: null,
		});

		expect(result.range).toEqual({ start: 3, end: 3 });
		expect(result.selection).toEqual({
			blockId: "p1",
			anchorOffset: 4,
			focusOffset: 4,
		});
	});

	it("FE9: the trusted typing caret wins over a different authority caret", () => {
		const result = resolveEditContextTextUpdateRange({
			blockId: "p1",
			updateRangeStart: 6,
			updateRangeEnd: 6,
			text: "x",
			isLogicallyEmpty: false,
			authority: { start: 3, end: 3 },
			trustedCaret: 6,
		});

		expect(result.range).toEqual({ start: 6, end: 6 });
	});

	it("a collapsed update replaces the authority's range", () => {
		const result = resolveEditContextTextUpdateRange({
			blockId: "p1",
			updateRangeStart: 5,
			updateRangeEnd: 5,
			text: "x",
			isLogicallyEmpty: false,
			authority: { start: 1, end: 4 },
			trustedCaret: 5,
		});

		expect(result.range).toEqual({ start: 1, end: 4 });
	});
});

describe("resolveEditContextKeyDownRange", () => {
	it("a text-editing key takes the trusted caret over a collapsed authority", () => {
		const result = resolveEditContextKeyDownRange({
			authority: { start: 11, end: 11 },
			trustedCaret: 3,
			isTextEditingKey: true,
			bufferRange: { start: 11, end: 11 },
		});

		expect(result.range).toEqual({ start: 3, end: 3 });
		expect(result.shouldSyncEditContextSelection).toBe(true);
	});

	it("another key keeps the authority and leaves a disagreeing buffer alone", () => {
		const result = resolveEditContextKeyDownRange({
			authority: { start: 11, end: 11 },
			trustedCaret: 3,
			isTextEditingKey: false,
			bufferRange: { start: 3, end: 3 },
		});

		expect(result.range).toEqual({ start: 11, end: 11 });
		expect(result.shouldSyncEditContextSelection).toBe(false);
	});

	it("an authority range wins over the trusted caret and syncs the buffer", () => {
		const result = resolveEditContextKeyDownRange({
			authority: { start: 2, end: 7 },
			trustedCaret: 3,
			isTextEditingKey: true,
			bufferRange: { start: 3, end: 3 },
		});

		expect(result.range).toEqual({ start: 2, end: 7 });
		expect(result.shouldSyncEditContextSelection).toBe(true);
	});

	it("with no authority in the field the buffer's range stands", () => {
		const result = resolveEditContextKeyDownRange({
			authority: null,
			trustedCaret: null,
			isTextEditingKey: true,
			bufferRange: { start: 4, end: 4 },
		});

		expect(result.range).toEqual({ start: 4, end: 4 });
		expect(result.shouldSyncEditContextSelection).toBe(false);
	});
});
