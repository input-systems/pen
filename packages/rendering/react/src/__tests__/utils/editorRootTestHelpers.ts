import { createEditor as createCoreEditor } from "@input/pen-core";
import { defaultPreset } from "@input/pen";
import { defaultSchema } from "@input/pen-schema";
import { act } from "react";
import type { Root } from "react-dom/client";

export function createEditor() {
	return createCoreEditor({
		schema: defaultSchema,
		preset: defaultPreset({
			tools: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

export async function cleanupEditor(
	editor: ReturnType<typeof createEditor>,
	root: Root,
	container: HTMLElement,
): Promise<void> {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	editor.destroy();
}
