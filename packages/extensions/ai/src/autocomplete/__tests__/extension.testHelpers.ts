import { defineExtension, type createEditor } from "@input/pen-core";
import { FIELD_EDITOR_SLOT_KEY } from "@input/pen-types";

export async function waitForCondition(
	check: () => boolean,
	maxTicks = 20,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (check()) {
			return;
		}
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Condition was not met in time.");
}

/**
 * A focused, editing field-editor stand-in plus the extension that assigns
 * it to the field-editor slot while the editor is active. `overrides` adds
 * or replaces fields on the stand-in.
 */
export function fieldEditorSlot<T extends object = object>(
	overrides: T = {} as T,
) {
	let activeEditor: ReturnType<typeof createEditor> | null = null;
	const fieldEditor = {
		focusBlockId: null as string | null,
		isEditing: true,
		isFocused: true,
		isComposing: false,
		...overrides,
	};
	return {
		fieldEditor,
		extension: defineExtension({
			name: "test-field-editor-slot",
			activateClient: async ({ editor: nextEditor }) => {
				activeEditor = nextEditor;
				nextEditor.internals.assignSlot(
					FIELD_EDITOR_SLOT_KEY,
					fieldEditor,
				);
			},
			deactivateClient: async () => {
				activeEditor?.internals.assignSlot(FIELD_EDITOR_SLOT_KEY, null);
				activeEditor = null;
			},
		}),
	};
}
