import type { DocumentOp } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { buildLazyNormalPositionSnapshot, buildNormalPositionSnapshot } from "../index";
import { createNestedEditor } from "./fixtures/structuralEdits";

describe("lazy normal-position snapshot", () => {
	it("SCALE2: a lazy normal-position snapshot answers like the eager one, including under a closed toggle", () => {
		const editor = createNestedEditor();
		const ops: DocumentOp[] = [
			{ type: "insert-block", blockId: "closed", blockType: "toggle", props: { open: false }, position: "last" },
			{ type: "insert-block", blockId: "hidden", blockType: "paragraph", props: {}, position: { parent: "closed", index: 0 } },
			{ type: "insert-block", blockId: "open", blockType: "toggle", props: { open: true }, position: "last" },
			{ type: "insert-block", blockId: "shown", blockType: "paragraph", props: {}, position: { parent: "open", index: 0 } },
			{ type: "splice-text", blockId: "shown", from: 0, to: 0, insert: "visible text" },
			{ type: "splice-text", blockId: "cols-a", from: 0, to: 0, insert: "in a column" },
		];
		editor.apply(ops);
		const eager = buildNormalPositionSnapshot(editor);
		const lazy = buildLazyNormalPositionSnapshot(editor);
		const candidates = [...editor.documentState.preorderBlockIds(), "missing"];
		for (const id of candidates) {
			expect(lazy.has?.(id), id).toBe(eager.blockOrder.includes(id));
			if (eager.blockOrder.includes(id)) expect(lazy.blocks[id], id).toEqual(eager.blocks[id]);
		}
		expect(lazy.has?.("hidden")).toBe(false);
		expect(lazy.has?.("cols-a")).toBe(true);
		expect(lazy.blockOrder).toEqual(eager.blockOrder);
		editor.destroy();
	});
});
