import { describe, expect, it } from "vitest";
import {
	resolveEditContextKeyDownRange,
	resolveEditContextTextUpdateRange,
} from "../editContextSelectionAuthority";

describe("resolveEditContextTextUpdateRange", () => {
	it("inserts at the trusted caret when the live update range is stale", () => {
		const result = resolveEditContextTextUpdateRange({
			blockId: "p1",
			updateRangeStart: 11,
			updateRangeEnd: 11,
			text: "!",
			isLogicallyEmpty: false,
			editorSelectionRange: null,
			authoritativeTextInputSelection: null,
			editorCaret: 3,
		});

		expect(result.range).toEqual({ start: 3, end: 3 });
		expect(result.selection).toEqual({
			blockId: "p1",
			anchorOffset: 4,
			focusOffset: 4,
		});
	});

	it("FE9: the trusted typing caret wins over a different editor caret", () => {
		const result = resolveEditContextTextUpdateRange({
			blockId: "p1",
			updateRangeStart: 6,
			updateRangeEnd: 6,
			text: "x",
			isLogicallyEmpty: false,
			editorSelectionRange: null,
			authoritativeTextInputSelection: {
				blockId: "p1",
				anchorOffset: 6,
				focusOffset: 6,
			},
			editorCaret: 3,
		});

		expect(result.range).toEqual({ start: 6, end: 6 });
	});
});

describe("resolveEditContextKeyDownRange", () => {
	it("prefers the trusted editor range over a stale live caret", () => {
		const result = resolveEditContextKeyDownRange({
			blockId: "p1",
			isTextEditingKey: true,
			liveDomOffsets: {
				anchor: 11,
				focus: 11,
				start: 11,
				end: 11,
			},
			editContextRange: { start: 11, end: 11 },
			editorSelectionRange: { start: 3, end: 3 },
			authoritativeTextInputSelection: null,
			collapsedEditorSelectionRange: null,
			synchronizedEditContextRange: null,
		});

		expect(result.range).toEqual({ start: 3, end: 3 });
		expect(result.shouldSyncEditContextSelection).toBe(true);
	});
});
