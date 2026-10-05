import type { ApplyOptions, DocumentOp, Editor } from "@input/pen-types";
import { defaultSchema } from "./fixtures/testSchema";
import { vi } from "vitest";

type TextDelta = { insert: string; attributes?: Record<string, unknown> };

export function createFakeEditor(
	documentProfile: Editor["documentProfile"],
): Editor {
	return {
		documentProfile,
		schema: defaultSchema,
		apply: vi.fn<(ops: DocumentOp[], options?: ApplyOptions) => void>(),
		facet: () => null,
		internals: {
			emit: vi.fn(),
		},
	} as unknown as Editor;
}

/** A block handle whose text is `text` unless `textContent`/`textDeltas` say otherwise. */
export function createMockBlockHandle(input: {
	id: string;
	type: string;
	text?: string;
	props?: Record<string, unknown>;
	textContent?: (options?: { resolved?: boolean }) => string;
	textDeltas?: () => TextDelta[];
	tableRowCount?: () => number;
	tableColumnCount?: () => number;
	tableColumns?: () => Array<{ id: string; title: string; type: "text" }>;
}) {
	const { text = "", ...rest } = input;
	return {
		props: {},
		children: [] as unknown[],
		textContent: () => text,
		textDeltas: (): TextDelta[] => (text ? [{ insert: text }] : []),
		tableRowCount: () => 0,
		tableColumnCount: () => 0,
		tableCell: () => null,
		tableRow: () => null,
		tableColumns: () => [],
		...rest,
		as(capability: string) {
			return capability === "table" && this.type === "table"
				? this
				: null;
		},
	};
}

export function createReadDocumentEditor(): Editor {
	const blocks = [
		createMockBlockHandle({
			id: "block-1",
			type: "paragraph",
			text: "First accepted",
		}),
		createMockBlockHandle({
			id: "block-2",
			type: "paragraph",
			textContent: (options) =>
				options?.resolved ? "Second" : "Second draft",
			textDeltas: () => [
				{ insert: "Second" },
				{
					insert: " draft",
					attributes: { suggestion: { action: "delete" } },
				},
			],
		}),
		createMockBlockHandle({
			id: "block-3",
			type: "heading",
			text: "Third",
		}),
	];

	return {
		documentProfile: "structured",
		schema: defaultSchema,
		facet: () => null,
		blockCount: () => 3,
		blocks: () => blocks,
		getBlock: (blockId: string) =>
			blocks.find((block) => block.id === blockId) ?? null,
		internals: {
			doc: {
				blockOrder: {
					length: 3,
					get: (index: number) => blocks[index]?.id,
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
	} as unknown as Editor;
}

export function createStructuredTargetEditor(
	activeBlockId: string,
	documentProfile: Editor["documentProfile"] = "structured",
): Editor {
	const blocks = [
		createMockBlockHandle({
			id: "paragraph-1",
			type: "paragraph",
			text: "Paragraph",
		}),
		createMockBlockHandle({
			id: "table-1",
			type: "table",
			props: { hasHeaderRow: true },
			tableRowCount: () => 3,
			tableColumnCount: () => 2,
			tableColumns: () => [
				{ id: "col-1", title: "Name", type: "text" },
				{ id: "col-2", title: "Status", type: "text" },
			],
		}),
		createMockBlockHandle({ id: "subdocument-1", type: "subdocument" }),
	];

	return {
		documentProfile,
		schema: defaultSchema,
		facet: () => null,
		apply: vi.fn<(ops: DocumentOp[], options?: ApplyOptions) => void>(),
		blocks: () => blocks,
		getBlock: (blockId: string) =>
			blocks.find((block) => block.id === blockId) ?? null,
		getSelection: () => ({
			type: "block",
			blockIds: [activeBlockId],
		}),
		getSelectedText: () => "",
	} as unknown as Editor;
}

export function createNestedDocumentEditor(): Editor {
	const topLevelBlocks = [
		createMockBlockHandle({
			id: "heading-1",
			type: "heading",
			props: { level: 1 },
			text: "Architecture",
		}),
		createMockBlockHandle({ id: "layout-1", type: "columns" }),
	];
	const nestedBlocks = [
		...topLevelBlocks,
		createMockBlockHandle({
			id: "paragraph-1",
			type: "paragraph",
			text: "Fast apply preserves stable block identity.",
		}),
	];

	return {
		documentProfile: "structured",
		schema: defaultSchema,
		facet: () => null,
		blocks: () => topLevelBlocks,
		documentState: {
			allBlocks: () => nestedBlocks,
		},
		getBlock: (blockId: string) =>
			nestedBlocks.find((block) => block.id === blockId) ?? null,
		getSelection: () => ({
			type: "text",
			anchor: { blockId: "paragraph-1", offset: 0 },
			focus: { blockId: "paragraph-1", offset: 4 },
		}),
		getSelectedText: () => "Fast",
	} as unknown as Editor;
}
