import { describe, expect, it } from "vitest";

import { applySplitBlock } from "../index";
import { createFlowEditor } from "./ops.testHelpers";

describe("ops profile parity GATE 4.9", () => {
	it("profile parity: flow still drops a flow-disallowed insert-block", () => {
		const editor = createFlowEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "w1",
				blockType: "widget",
				props: {},
				position: "last",
			},
		]);
		expect(editor.getBlock("w1")).toBeNull();
		editor.destroy();
	});

	it("profile parity: flow still drops a set-props type conversion to a disallowed type", () => {
		const editor = createFlowEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "set-props",
				blockId,
				props: { type: "widget" },
			},
		]);
		expect(editor.getBlock(blockId)!.type).toBe("paragraph");
		editor.destroy();
	});

	it("profile parity: a split recipe that inserts a disallowed type is dropped", () => {
		const editor = createFlowEditor();
		const source = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId: source,
				from: 0,
				to: 0,
				insert: "hello world",
			},
		]);
		applySplitBlock(editor, {
			blockId: source,
			offset: 6,
			newBlockId: "w-split",
			newBlockType: "widget",
			applyOptions: {
				origin: { type: "user", intent: "pen.splitBlock" },
			},
		});
		expect(editor.getBlock("w-split")).toBeNull();
		editor.destroy();
	});

	it("profile parity: flow still allows a delegated table insert", () => {
		const editor = createFlowEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
		expect(editor.getBlock("t1")!.type).toBe("table");
		editor.destroy();
	});

	it("profile parity: splice-text is not profile-controlled", () => {
		const editor = createFlowEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "ok",
			},
		]);
		expect(editor.getBlock(blockId)!.textContent()).toBe("ok");
		editor.destroy();
	});
});
