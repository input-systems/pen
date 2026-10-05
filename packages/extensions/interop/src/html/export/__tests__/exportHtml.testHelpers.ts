import { createEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";

export const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

export function editorWithBlocks(
	ops: Parameters<ReturnType<typeof createEditor>["apply"]>[0],
) {
	const editor = createEditor({
		schema: defaultSchema,
		preset: noDefaultExtensionsPreset,
	});
	editor.apply(ops);
	return editor;
}
