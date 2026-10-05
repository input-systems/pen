import { createEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";

export const BLOCK_TYPE_OPTIONS = [
	{ value: "paragraph", label: "Paragraph" },
	{ value: "heading", label: "Heading" },
];

export const TABLE_BLOCK_TYPE_OPTIONS = [
	{ value: "paragraph", label: "Paragraph" },
	{ value: "table", label: "Table" },
];

export function visibleText(text: string | null | undefined): string {
	return (text ?? "").replace(/\u200B/g, "");
}

export function numberedListMarkers(container: HTMLElement): string[] {
	return Array.from(
		container.querySelectorAll(
			"[data-pen-list-item-layout][data-block-type='numberedListItem'] [data-pen-list-marker]",
		),
	).map((marker) => marker.textContent ?? "");
}

export function createBlockTypeEditor(
	options: Parameters<typeof createEditor>[0] = {},
) {
	return createEditor({
		schema: defaultSchema,
		...options,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}
