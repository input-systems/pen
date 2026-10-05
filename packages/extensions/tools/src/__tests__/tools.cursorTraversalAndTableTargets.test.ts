import type { Editor } from "@input/pen-types";
import { describe, expect, it, vi } from "vitest";
import { getCursorContextTool } from "../tools/getCursorContext";
import { inspectTargetTool } from "../tools/inspectTarget";
import { listValidOperationsTool } from "../tools/listValidOperations";
import {
	createReadDocumentEditor,
	createStructuredTargetEditor,
} from "./tools.testHelpers";

describe("@input/pen-tools tools: cursor traversal and table targets", () => {
	it("uses bounded neighbor traversal for cursor context when block links exist", async () => {
		const base = createReadDocumentEditor();
		const [first, second, third] = base.blocks() as unknown as Array<{
			prev?: unknown;
			next?: unknown;
		}>;
		Object.assign(first, { prev: null, next: second });
		Object.assign(second, { prev: first, next: third });
		Object.assign(third, { prev: second, next: null });
		const editor = {
			...base,
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
