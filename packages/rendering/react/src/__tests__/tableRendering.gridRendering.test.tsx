// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import {
	TableBlockMapLike,
	createEditor,
} from "./utils/tableRenderingTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@input/pen-react table rendering: the cell grid", () => {
	it("renders a table block with cells from the canonical model", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: { hasHeaderRow: true },
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "Alice",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 1 },
				from: 0,
				to: 0,
				insert: "30",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 1, col: 0 },
				from: 0,
				to: 0,
				insert: "Bob",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 1, col: 1 },
				from: 0,
				to: 0,
				insert: "25",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const table = container.querySelector("table");
		expect(table).not.toBeNull();

		const thead = table!.querySelector("thead");
		expect(thead).not.toBeNull();

		const tbody = table!.querySelector("tbody");
		expect(tbody).not.toBeNull();

		const headerCells = thead!.querySelectorAll("th");
		expect(headerCells.length).toBeGreaterThanOrEqual(2);

		const bodyCells = tbody!.querySelectorAll("td[data-pen-table-cell]");
		expect(bodyCells.length).toBe(2);

		expect(bodyCells[0].getAttribute("data-cell-row")).toBe("1");
		expect(bodyCells[0].getAttribute("data-cell-col")).toBe("0");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("RI1 RI5: every table cell content host is unicode-bidi isolate and pre-wrap", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: { hasHeaderRow: true },
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "مرحبا",
			},
			{
				type: "splice-text",
				blockId: "t1",
				cell: { row: 1, col: 1 },
				from: 0,
				to: 0,
				insert: "Hello",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const table = container.querySelector("table");
		const surfaces = table!.querySelectorAll("[data-pen-inline-content]");
		// A writer that stamps one surface per block satisfies a single-cell
		// assertion, so the count guard is what makes the loop below mean
		// anything.
		expect(surfaces.length).toBeGreaterThan(1);
		for (const surface of surfaces) {
			expect((surface as HTMLElement).style.unicodeBidi).toBe("isolate");
			expect((surface as HTMLElement).style.whiteSpace).toBe("pre-wrap");
		}

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders cell text content through TableCellContent", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t2",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "t2",
				cell: { row: 0, col: 0 },
				from: 0,
				to: 0,
				insert: "Hello",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const cellInlineContent = container.querySelector(
			"[data-pen-inline-content][data-cell-row='0'][data-cell-col='0']",
		);
		expect(cellInlineContent).not.toBeNull();
		expect(
			cellInlineContent?.hasAttribute("data-pen-field-editor-surface"),
		).toBe(true);
		const text = (cellInlineContent?.textContent ?? "").replace(
			/\u200B/g,
			"",
		);
		expect(text).toBe("Hello");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("updates cell content when table ops are applied after render", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t3",
				blockType: "table",
				props: { hasHeaderRow: false },
				position: "last",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		let bodyCells = container.querySelectorAll(
			"tbody td[data-pen-table-cell]",
		);
		expect(bodyCells.length).toBe(4);

		await act(async () => {
			editor.apply([
				{
					type: "grid",
					blockId: "t3",
					change: { kind: "insert-row", index: 2 },
				},
			]);
		});

		bodyCells = container.querySelectorAll("tbody td[data-pen-table-cell]");
		expect(bodyCells.length).toBe(6);

		await act(async () => {
			editor.apply([
				{
					type: "grid",
					blockId: "t3",
					change: { kind: "insert-column", index: 2 },
				},
			]);
		});

		bodyCells = container.querySelectorAll("tbody td[data-pen-table-cell]");
		expect(bodyCells.length).toBe(9);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders header row with placeholders when hasHeaderRow is set", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t4",
				blockType: "table",
				props: { hasHeaderRow: true },
				position: "last",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const thead = container.querySelector("thead");
		expect(thead).not.toBeNull();
		const headerCells = thead!.querySelectorAll("th");
		expect(headerCells.length).toBeGreaterThanOrEqual(2);

		expect(container.querySelector("[data-pen-table]")).not.toBeNull();
		expect(
			container.querySelector("[data-pen-table-frame]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders a full row grid even when a legacy row is missing trailing cells", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t4-short-row",
				blockType: "table",
				props: { hasHeaderRow: false },
				position: "last",
			},
			{
				type: "grid",
				blockId: "t4-short-row",
				change: { kind: "insert-column", index: 2 },
			},
		]);

		const blockMap = editor.internals.doc.blocks.get(
			"t4-short-row",
		) as TableBlockMapLike;
		const tableContent = blockMap.get("tableContent");
		const firstRow = tableContent.get(0);
		firstRow.get("cells").delete(2, 1);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const firstRowCells = container.querySelectorAll(
			`[data-block-id="t4-short-row"] tbody tr[data-row="0"] td[data-pen-table-cell]`,
		);
		expect(firstRowCells).toHaveLength(3);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders add row and column controls outside the table grid", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t4-controls",
				blockType: "table",
				props: { hasHeaderRow: true },
				position: "last",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const table = container.querySelector(
			`[data-block-id="t4-controls"] [data-pen-table]`,
		);
		const addColumnControl = container.querySelector(
			`[data-block-id="t4-controls"] button[aria-label="Add column"]`,
		);
		const addRowControl = container.querySelector(
			`[data-block-id="t4-controls"] button[aria-label="Add row"]`,
		);

		expect(table).not.toBeNull();
		expect(addColumnControl).not.toBeNull();
		expect(addRowControl).not.toBeNull();
		expect(table?.contains(addColumnControl)).toBe(false);
		expect(table?.contains(addRowControl)).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("reconciles a nested table cell after its text is deleted", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "host4-table",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "host4-table",
				cell: { row: 1, col: 0 },
				from: 0,
				to: 0,
				insert: "Cell before",
			},
		]);
		expect(
			editor
				.getBlock("host4-table")
				?.as("table")
				?.tableCell(1, 0)
				?.textContent(),
		).toBe("Cell before");

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const cellSelector =
			"[data-pen-inline-content][data-cell-row='1'][data-cell-col='0']";
		const visible = (node: Element | null) =>
			(node?.textContent ?? "").replace(/\u200B/g, "");

		expect(visible(container.querySelector(cellSelector))).toBe(
			"Cell before",
		);

		await act(async () => {
			editor.apply([
				{
					type: "splice-text",
					blockId: "host4-table",
					cell: { row: 1, col: 0 },
					from: 0,
					to: 11,
					insert: "",
				},
			]);
		});

		expect(visible(container.querySelector(cellSelector))).toBe("");
		expect(visible(container.querySelector(cellSelector))).not.toContain(
			"Cell before",
		);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
