import type { DiagnosticEvent } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { mintingSiteFrom } from "../editor/anchors";
import { createEditor as createCoreEditor } from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createEditor() {
	return createCoreEditor({
		schema: createDefaultSchema(),
		preset: noDefaultExtensionsPreset,
	});
}

function seedText(
	editor: ReturnType<typeof createEditor>,
	text: string,
): string {
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "splice-text", blockId, from: 0, to: 0, insert: text },
	]);
	return blockId;
}

function seedTableCell(
	editor: ReturnType<typeof createEditor>,
	tableId: string,
	row: number,
	col: number,
	text: string,
): void {
	if (!editor.getBlock(tableId)) {
		editor.apply([
			{
				type: "insert-block",
				blockId: tableId,
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
	}
	editor.apply([
		{
			type: "splice-text",
			blockId: tableId,
			cell: { row, col },
			from: 0,
			to: 0,
			insert: text,
		},
	]);
}

describe("editor.anchors AN1", () => {
	it("AN1: create returns null and emits anchor-target-missing when the block is gone", () => {
		const editor = createEditor();
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		expect(
			editor.anchors.create({ blockId: "missing", offset: 0 }),
		).toBeNull();
		expect(
			diagnostics.some((event) => event.code === "anchor-target-missing"),
		).toBe(true);
		editor.destroy();
	});

	it("AN1: resolve of an anchor whose block was removed is null", () => {
		const editor = createEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "keep",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		const initial = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId: initial,
				from: 0,
				to: 0,
				insert: "gone",
			},
		]);
		const anchor = editor.anchors.create(
			{ blockId: initial, offset: 2 },
			1,
		)!;
		editor.apply([{ type: "delete-block", blockId: initial }]);
		expect(editor.anchors.resolve(anchor)).toBeNull();
		editor.destroy();
	});
});

describe("editor.anchors AN5", () => {
	it("AN5: deleting a range interior collapses both endpoints", () => {
		const editor = createEditor();
		const blockId = seedText(editor, "meadow sage");
		const range = editor.anchors.range({
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 6 },
		})!;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 3,
				to: 6,
				insert: "",
			},
		]);
		const resolved = editor.anchors.resolveRange(range);
		expect(resolved).toEqual({
			from: { blockId, offset: 3 },
			to: { blockId, offset: 3 },
			collapsed: true,
		});
		editor.destroy();
	});
});

describe("editor.anchors AN6 AN11 AN12", () => {
	it("AN11: serialize is v1 JSON and deserialize stamps wire provenance", () => {
		const editor = createEditor();
		const blockId = seedText(editor, "hello");
		const local = editor.anchors.create({ blockId, offset: 2 }, -1)!;
		expect(local.provenance).toBe("local");
		const wire = JSON.parse(editor.anchors.serialize(local)) as {
			v: number;
			b: string;
			a: number;
			p: string;
		};
		expect(wire).toMatchObject({ v: 1, b: blockId, a: -1 });
		expect(typeof wire.p).toBe("string");
		const restored = editor.anchors.deserialize(
			editor.anchors.serialize(local),
		)!;
		expect(restored.provenance).toBe("wire");
		expect(restored.blockId).toBe(blockId);
		expect(restored.assoc).toBe(-1);
		expect(editor.anchors.resolve(restored)).toEqual({
			blockId,
			offset: 2,
		});
		editor.destroy();
	});

	it("AN12: minted anchors are deep-frozen values", () => {
		const editor = createEditor();
		const blockId = seedText(editor, "hello");
		const anchor = editor.anchors.create({ blockId, offset: 1 }, 1)!;
		expect(Object.isFrozen(anchor)).toBe(true);
		expect(() => {
			(anchor as { blockId: string }).blockId = "nope";
		}).toThrow();
		editor.destroy();
	});

	it("AN6: serialize then deserialize then resolve is identity for a live target", () => {
		const editor = createEditor();
		const blockId = seedText(editor, "round trip");
		const anchor = editor.anchors.create({ blockId, offset: 5 }, 1)!;
		const again = editor.anchors.deserialize(
			editor.anchors.serialize(anchor),
		)!;
		expect(editor.anchors.resolve(again)).toEqual(
			editor.anchors.resolve(anchor),
		);
		editor.destroy();
	});
});

describe("editor.anchors AN8", () => {
	it("AN8: resolve of the same anchor within one commit hits the adapter once", () => {
		const editor = createEditor();
		const blockId = seedText(editor, "cached");
		const anchor = editor.anchors.create({ blockId, offset: 2 }, 1)!;
		const adapter = editor.internals.adapter;
		let calls = 0;
		const original = adapter.resolveRelativePosition.bind(adapter);
		adapter.resolveRelativePosition = (doc, encoded, options) => {
			calls += 1;
			return original(doc, encoded, options);
		};
		expect(editor.anchors.resolve(anchor)).toEqual({ blockId, offset: 2 });
		expect(editor.anchors.resolve(anchor)).toEqual({ blockId, offset: 2 });
		expect(calls).toBe(1);
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: "xx" },
		]);
		expect(editor.anchors.resolve(anchor)).toEqual({ blockId, offset: 4 });
		expect(editor.anchors.resolve(anchor)).toEqual({ blockId, offset: 4 });
		expect(calls).toBe(2);
		editor.destroy();
	});
});

describe("editor.anchors AN9", () => {
	it("AN9: minting past 4096 emits one budget diagnostic that names the site", () => {
		const editor = createEditor();
		const blockId = seedText(editor, "budget");
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		for (let i = 0; i < 5000; i++) {
			editor.anchors.create({ blockId, offset: 0 }, 1);
		}
		const budget = diagnostics.filter(
			(event) => event.code === "anchor-budget",
		);
		expect(budget).toHaveLength(1);
		expect(typeof budget[0]?.site).toBe("string");
		expect(String(budget[0]?.site)).toContain("anchors.test.ts");
		expect(editor.anchors.liveCount).toBe(5000);
		editor.destroy();
	});

	it("AN9: the budget site names the caller in a bundled build, not the site helper", () => {
		const bundled = [
			"Error",
			"    at mintingSite (file:///app/node_modules/@input/pen-core/dist/index.mjs:5426:17)",
			"    at EditorAnchorsImpl._noteMint (file:///app/node_modules/@input/pen-core/dist/index.mjs:5600:20)",
			"    at EditorAnchorsImpl.remint (file:///app/node_modules/@input/pen-core/dist/index.mjs:5480:10)",
			"    at EditorAnchorsImpl.create (file:///app/node_modules/@input/pen-core/dist/index.mjs:5490:23)",
			"    at mintDrift (file:///app/node_modules/@input/pen-undo/dist/index.mjs:485:32)",
		].join("\n");
		expect(mintingSiteFrom(bundled)).toBe(
			"at mintDrift (file:///app/node_modules/@input/pen-undo/dist/index.mjs:485:32)",
		);
	});
});

describe("editor.anchors AN13", () => {
	it("AN13: local provenance follows the undoer's restored character; wire converges at the boundary", () => {
		const editor = createEditor();
		const blockId = seedText(editor, "hello world");
		const local = editor.anchors.create({ blockId, offset: 6 }, 1)!;
		const wire = editor.anchors.deserialize(
			editor.anchors.serialize(local),
		)!;
		expect(local.provenance).toBe("local");
		expect(wire.provenance).toBe("wire");
		const undo = editor.internals.adapter.createUndoManager(
			editor.internals.crdtDoc,
		);
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 6,
				to: 11,
				insert: "",
			},
		]);
		undo.undo();
		expect(editor.anchors.resolve(local)).toEqual({ blockId, offset: 6 });
		expect(editor.anchors.resolve(wire)).toEqual({ blockId, offset: 11 });
		editor.destroy();
	});
});

describe("editor.anchors values", () => {
	it("create never throws and range is null when either end is missing", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		expect(
			editor.anchors.range({
				anchor: { blockId, offset: 0 },
				focus: { blockId: "missing", offset: 0 },
			}),
		).toBeNull();
		editor.destroy();
	});
});

describe("editor.anchors AN10 table-cell cohort", () => {
	it("AN10: mint and resolve against tableContent[row].cells[col], not block.content", () => {
		const editor = createEditor();
		seedTableCell(editor, "t1", 1, 1, "cell text");
		const missingCell = editor.anchors.create({ blockId: "t1", offset: 0 });
		expect(missingCell).toBeNull();
		const anchor = editor.anchors.create(
			{ blockId: "t1", offset: 5, cell: { row: 1, col: 1 } },
			1,
		);
		expect(anchor).not.toBeNull();
		expect(anchor?.cell).toEqual({ row: 1, col: 1 });
		expect(editor.anchors.resolve(anchor!)).toEqual({
			blockId: "t1",
			offset: 5,
			cell: { row: 1, col: 1 },
		});
		editor.destroy();
	});

	it("AN10: in-cell insert shifts the mint and in-cell delete collapses it", () => {
		const editor = createEditor();
		seedTableCell(editor, "t1", 1, 1, "0123456789");
		const target = { blockId: "t1", offset: 5, cell: { row: 1, col: 1 } };
		const insertAnchor = editor.anchors.create(target, 1)!;
		const deleteAnchor = editor.anchors.create(target, 1)!;
		editor.apply([
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 1, col: 1 },
				from: 0,
				to: 0,
				insert: "xx",
			},
		]);
		expect(editor.anchors.resolve(insertAnchor)).toEqual({
			blockId: "t1",
			offset: 7,
			cell: { row: 1, col: 1 },
		});
		editor.apply([
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 1, col: 1 },
				from: 3,
				to: 7,
				insert: "",
			},
		]);
		expect(editor.anchors.resolve(deleteAnchor)).toEqual({
			blockId: "t1",
			offset: 3,
			cell: { row: 1, col: 1 },
		});
		expect(
			editor.getBlock("t1")!.as("table")!.tableCell(1, 1)!.textContent(),
		).toBe("xx056789");
		editor.destroy();
	});

	it("AN11: cell serialize stamps c and deserialize restores the cell", () => {
		const editor = createEditor();
		seedTableCell(editor, "t1", 0, 1, "hello");
		const local = editor.anchors.create(
			{ blockId: "t1", offset: 2, cell: { row: 0, col: 1 } },
			-1,
		)!;
		const wire = JSON.parse(editor.anchors.serialize(local)) as {
			v: number;
			b: string;
			a: number;
			c: [number, number];
			p: string;
		};
		expect(wire).toMatchObject({ v: 1, b: "t1", a: -1, c: [0, 1] });
		const restored = editor.anchors.deserialize(
			editor.anchors.serialize(local),
		)!;
		expect(restored.provenance).toBe("wire");
		expect(restored.cell).toEqual({ row: 0, col: 1 });
		expect(editor.anchors.resolve(restored)).toEqual({
			blockId: "t1",
			offset: 2,
			cell: { row: 0, col: 1 },
		});
		editor.destroy();
	});
});
