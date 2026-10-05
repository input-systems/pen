import { createEditor as createCoreEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import type { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { vi } from "vitest";

export function createEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
	config: {
		undo?: boolean;
	} = {},
) {
	return createCoreEditor({
		schema: defaultSchema,
		...options,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: config.undo ?? false,
		}),
	});
}

export function createFileList(files: File[]): FileList {
	return Object.assign([...files], {
		item(index: number) {
			return files[index] ?? null;
		},
	}) as unknown as FileList;
}

export function createClipboardData(files: File[] = []): DataTransfer {
	const data = new Map<string, string>();
	const types: string[] = files.length > 0 ? ["Files"] : [];

	return {
		files: createFileList(files),
		types,
		getData(type: string) {
			return data.get(type) ?? "";
		},
		setData(type: string, value: string) {
			data.set(type, value);
		},
	} as unknown as DataTransfer;
}

export function createFieldEditorStub(): FieldEditorImpl {
	return {
		activateTextSelection: vi.fn(),
	} as unknown as FieldEditorImpl;
}

export function getClipboardPenBlocks(
	clipboardData: DataTransfer,
): Array<{ type?: string; content?: string }> {
	const parsed = JSON.parse(
		clipboardData.getData("application/x-pen-blocks"),
	) as
		| { blocks?: Array<{ type?: string; content?: string }> }
		| Array<{
				type?: string;
				content?: string;
		  }>;
	return Array.isArray(parsed) ? parsed : (parsed.blocks ?? []);
}

export function seedTable(
	editor: ReturnType<typeof createEditor>,
	tableId: string,
): void {
	editor.apply([
		{
			type: "insert-block",
			blockId: tableId,
			blockType: "table",
			props: {},
			position: "last",
		},
		{
			type: "splice-text",
			blockId: tableId,
			cell: { row: 0, col: 0 },
			from: 0,
			to: 0,
			insert: "Alpha",
		},
		{
			type: "splice-text",
			blockId: tableId,
			cell: { row: 0, col: 1 },
			from: 0,
			to: 0,
			insert: "Bravo",
		},
	]);
}
