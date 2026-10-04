import type { CommitEvent, DiagnosticEvent } from "@input/pen-types";
import { describe, expect, it } from "vitest";

import { createEditor } from "./ops.testHelpers";

describe("ops primitives PR1–PR10", () => {
	it("PR1: splice-text clamps out-of-range from/to and emits op-clamped", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "hi",
			},
		]);
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 40,
				to: 80,
				insert: "!",
			},
		]);
		expect(editor.getBlock(blockId)!.textContent()).toBe("hi!");
		expect(diagnostics).toContainEqual(
			expect.objectContaining({ code: "op-clamped" }),
		);
		editor.destroy();
	});

	it("PR1: splice-text inserts an inline atom at one logical offset", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "ab",
			},
			{
				type: "splice-text",
				blockId,
				from: 1,
				to: 1,
				insert: {
					nodeType: "mention",
					props: { id: "1", label: "Ada" },
				},
			},
		]);
		expect(editor.getBlock(blockId)!.length()).toBe(3);
		expect(editor.getBlock(blockId)!.inlineDeltas()).toEqual([
			{ insert: "a" },
			{
				insert: { type: "mention", props: { id: "1", label: "Ada" } },
			},
			{ insert: "b" },
		]);
		editor.destroy();
	});

	it("PR1: splice-text with cell writes table cell text", () => {
		const editor = createEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "cell",
			},
		]);
		expect(
			editor.getBlock("t1")!.as("table")!.tableCell(0, 0)!.textContent(),
		).toBe("cell");
		editor.destroy();
	});

	it("PR2: format-text marks-null clears a mark and never splices text", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "Hi",
				marks: { bold: true },
			},
		]);
		expect(editor.getBlock(blockId)!.textDeltas()).toEqual([
			{ insert: "Hi", attributes: { bold: true } },
		]);
		editor.apply([
			{
				type: "format-text",
				blockId,
				from: 0,
				to: 2,
				marks: { bold: null },
			},
		]);
		expect(editor.getBlock(blockId)!.textContent()).toBe("Hi");
		expect(editor.getBlock(blockId)!.textDeltas()).toEqual([
			{ insert: "Hi" },
		]);
		editor.destroy();
	});

	it("PR3: insert-block accepts a same-batch splice targeting the pending block", () => {
		const editor = createEditor();
		const seed = editor.firstBlock()!.id;
		editor.apply([{ type: "delete-block", blockId: seed }]);
		editor.apply([
			{
				type: "insert-block",
				blockId: "p1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "p1",
				from: 0,
				to: 0,
				insert: "ready",
			},
		]);
		expect(editor.getBlock("p1")!.textContent()).toBe("ready");
		editor.destroy();
	});

	it("PR3: insert-block naming a live block is dropped, not applied as a reset", () => {
		const editor = createEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "p1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "p1",
				from: 0,
				to: 0,
				insert: "user content",
			},
		]);
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "p1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		expect(editor.getBlock("p1")!.textContent()).toBe("user content");
		expect(
			editor.documentState.blockOrder.filter((id) => id === "p1"),
		).toEqual(["p1"]);
		expect(diagnostics).toEqual([
			expect.objectContaining({ code: "PEN_APPLY_010" }),
		]);
		editor.destroy();
	});

	it("PR3: a second insert-block for the same id in one batch is dropped", () => {
		const editor = createEditor();
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "dup",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "dup",
				from: 0,
				to: 0,
				insert: "kept",
			},
			{
				type: "insert-block",
				blockId: "dup",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		expect(editor.getBlock("dup")!.textContent()).toBe("kept");
		expect(
			editor.documentState.blockOrder.filter((id) => id === "dup"),
		).toEqual(["dup"]);
		expect(diagnostics).toEqual([
			expect.objectContaining({ code: "PEN_APPLY_010" }),
		]);
		editor.destroy();
	});

	it("PR4: delete-block removes the block", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([{ type: "delete-block", blockId }]);
		expect(editor.getBlock(blockId)).toBeNull();
		editor.destroy();
	});

	it("PR5: move-block reorders by position", () => {
		const editor = createEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "p2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		const first = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "move-block",
				blockId: first,
				position: "last",
			},
		]);
		expect(editor.documentState.blockOrder.at(-1)).toBe(first);
		editor.destroy();
	});

	it("PR6: set-props type-change revalidates and drops incompatible keys", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "set-props",
				blockId,
				props: { type: "heading", level: 2 },
			},
		]);
		expect(editor.getBlock(blockId)!.type).toBe("heading");
		expect(editor.getBlock(blockId)!.props.level).toBe(2);
		editor.apply([
			{
				type: "set-props",
				blockId,
				props: { type: "paragraph" },
			},
		]);
		expect(editor.getBlock(blockId)!.type).toBe("paragraph");
		expect(editor.getBlock(blockId)!.props.level).toBeUndefined();
		editor.destroy();
	});

	it("PR7: set-meta merges a namespace and null clears it", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "set-meta",
				blockId,
				namespace: "note",
				data: { a: 1 },
			},
		]);
		expect(editor.getBlock(blockId)!.meta("note")).toEqual({ a: 1 });
		editor.apply([
			{
				type: "set-meta",
				blockId,
				namespace: "note",
				data: null,
			},
		]);
		expect(editor.getBlock(blockId)!.meta("note")).toBeNull();
		editor.destroy();
	});

	it("PR8: grid kinds insert and delete rows and columns; merge/split stay no-ops", () => {
		const editor = createEditor();
		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
		const table = () => editor.getBlock("t1")!.as("table")!;
		const seedRows = table().tableRowCount();
		const seedCols = table().tableColumnCount();
		editor.apply([
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "insert-row", index: seedRows },
			},
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "insert-column", index: seedCols },
			},
		]);
		expect(table().tableRowCount()).toBe(seedRows + 1);
		expect(table().tableColumnCount()).toBe(seedCols + 1);
		editor.apply([
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "delete-row", index: seedRows },
			},
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "delete-column", index: seedCols },
			},
			{
				type: "grid",
				blockId: "t1",
				change: {
					kind: "merge-cells",
					anchor: { row: 0, col: 0 },
					head: { row: 0, col: 1 },
				},
			},
			{
				type: "grid",
				blockId: "t1",
				change: { kind: "split-cell", row: 0, col: 0 },
			},
		]);
		expect(table().tableRowCount()).toBe(seedRows);
		expect(table().tableColumnCount()).toBe(seedCols);
		editor.destroy();
	});

	it("PR9: app create, update, and delete kinds write apps-changed", () => {
		const editor = createEditor();
		const host = editor.firstBlock()!.id;
		const summaries: CommitEvent["summary"][] = [];
		editor.on("commit", (event) => {
			summaries.push(event.summary);
		});
		editor.apply([
			{
				type: "app",
				change: {
					kind: "create",
					appId: "app-1",
					appType: "counter",
					config: { n: 1 },
					placement: { mode: "inline", blockId: host, index: 0 },
				},
			},
		]);
		editor.apply([
			{
				type: "app",
				change: { kind: "update", appId: "app-1", patch: { n: 2 } },
			},
		]);
		editor.apply([
			{
				type: "app",
				change: { kind: "delete", appId: "app-1" },
			},
		]);
		expect(
			summaries.every((summary) =>
				summary.structural.some(
					(change) =>
						change.type === "apps-changed" &&
						change.appIds.includes("app-1"),
				),
			),
		).toBe(true);
		editor.destroy();
	});

	it("PR10: stream-open is vetoable at openTextStream", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const commits: CommitEvent[] = [];
		editor.on("commit", (event) => {
			commits.push(event);
		});
		editor.onBeforeApply((ops) => {
			if (ops.some((op) => op.type === "stream-open")) {
				return [];
			}
			return ops;
		});
		const writer = editor.openTextStream(
			{ blockId },
			{ origin: { type: "ai", groupId: "pr10-veto" } },
		);
		writer.append("vetoed");
		writer.flush();
		expect(commits).toHaveLength(0);
		expect(editor.getBlock(blockId)!.textContent()).toBe("");
		editor.destroy();
	});
});
