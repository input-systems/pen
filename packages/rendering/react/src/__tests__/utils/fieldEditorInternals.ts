import type { FieldEditorImpl } from "@input/pen-dom";

/**
 * The pen-dom sub-controllers these tests drive. They are `@internal`, so
 * the published `FieldEditorImpl` type does not carry them.
 */
type FieldEditorInternals = {
	reader: {
		notifyGesture(kind: "pointerdown"): void;
		isAdmissibleRead(): boolean;
	};
	pendingMarks: {
		resolveInsertMarks(
			ytext: unknown,
			offset: number,
		): Record<string, unknown | null> | undefined;
	};
};

export function fieldEditorInternals(
	fieldEditor: FieldEditorImpl,
): FieldEditorInternals {
	return fieldEditor as unknown as FieldEditorInternals;
}
