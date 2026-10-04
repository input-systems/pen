import { defaultSchema } from "./fixtures/testSchema";
import type { Editor } from "@input/pen-types";
import { describe, expect, it, vi } from "vitest";
import { getCursorContextTool } from "../tools/getCursorContext";
import { inspectTargetTool } from "../tools/inspectTarget";
import { listValidOperationsTool } from "../tools/listValidOperations";
import {
	createMockBlockHandle,
	createStructuredTargetEditor,
} from "./tools.testHelpers";

describe("@input/pen-tools tools: cursor traversal and table targets", () => {
	it("uses bounded neighbor traversal for cursor context when block links exist", async () => {
		const blocks: Array<{
			id: string;
			type: string;
			props: Record<string, unknown>;
			children: unknown[];
			textContent: () => string;
			textDeltas: () => Array<{ insert: string }>;
			tableRowCount: () => number;
			tableColumnCount: () => number;
			tableCell: () => null;
			tableRow: () => null;
			tableColumns: () => never[];
			prev?: unknown;
			next?: unknown;
		}> = [
			createMockBlockHandle({
				id: "block-1",
				type: "paragraph",
				props: {},
				children: [],
				textContent: () => "First",
				textDeltas: () => [{ insert: "First" }],
				prev: null,
				next: null,
			}),
			createMockBlockHandle({
				id: "block-2",
				type: "paragraph",
				props: {},
				children: [],
				textContent: () => "Second",
				textDeltas: () => [{ insert: "Second" }],
				prev: null,
				next: null,
			}),
			createMockBlockHandle({
				id: "block-3",
				type: "paragraph",
				props: {},
				children: [],
				textContent: () => "Third",
				textDeltas: () => [{ insert: "Third" }],
				prev: null,
				next: null,
			}),
		];
		blocks[0].next = blocks[1];
		blocks[1].prev = blocks[0];
		blocks[1].next = blocks[2];
		blocks[2].prev = blocks[1];

		const editor = {
			documentProfile: "structured",
			schema: defaultSchema,
			facet: () => null,
			internals: {
				doc: {
					blockOrder: {
						length: 3,
						get: (index: number) =>
							["block-1", "block-2", "block-3"][index],
					},
					blocks: { get: () => undefined },
				},
			},
			getSelection: () => ({
				type: "text",
				anchor: { blockId: "block-2", offset: 0 },
				focus: { blockId: "block-2", offset: 6 },
			}),
			getSelectedText: () => "Second",
			getBlock: (blockId: string) =>
				blocks.find((block) => block.id === blockId) ?? null,
			blocks: vi.fn(() => {
				throw new Error(
					"Cursor context should not scan the full document.",
				);
			}),
		} as unknown as Editor;

		const result = (await getCursorContextTool(editor).handler(
			{},
			{} as never,
		)) as {
			surroundingBlocks: Array<{ id: string }>;
		};

		expect(result.surroundingBlocks.map((block) => block.id)).toEqual([
			"block-1",
			"block-2",
			"block-3",
		]);
	});

	it("inspects table targets with schema-aware details", async () => {
		const editor = createStructuredTargetEditor("table-1");

		const result = (await inspectTargetTool(editor).handler(
			{},
			{} as never,
		)) as {
			target: {
				target: {
					kind: string;
					rowCount: number;
					columnCount: number;
				};
				validOperations: string[];
			} | null;
		};

		expect(result.target?.target).toMatchObject({
			kind: "table",
			rowCount: 3,
			columnCount: 2,
		});
		expect(result.target?.validOperations).toContain("insert_row");
		expect(result.target?.validOperations).toContain("set_cell_text");
	});

	it("returns no valid mutation operations for read-only targets", async () => {
		const editor = createStructuredTargetEditor("subdocument-1");

		const result = (await listValidOperationsTool(editor).handler(
			{},
			{} as never,
		)) as {
			operations: string[];
		};

		expect(result.operations).toEqual([]);
	});
});
