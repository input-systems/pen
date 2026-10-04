import type { Editor } from "@input/pen-types";

const MARK_ACCELERATOR_KEYS: Readonly<Record<string, string>> = {
	b: "bold",
	i: "italic",
	u: "underline",
};

/**
 * The mark a platform bold/italic/underline accelerator names, or `null`.
 *
 * Mod is either modifier, matching the history shortcuts: a cell declines the
 * toggle on every platform, so there is nothing to gain from guessing which
 * one the host OS uses.
 */
export function markForAccelerator(event: KeyboardEvent): string | null {
	if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) {
		return null;
	}
	return MARK_ACCELERATOR_KEYS[event.key.toLowerCase()] ?? null;
}

/** FE6: a mark toggle inside a table cell declines, observably. */
export function reportCellMarkDecline(editor: Editor, mark: string): void {
	editor.internals.emit("diagnostic", {
		code: "cell-capability-unsupported",
		level: "info",
		source: "field-editor",
		message: `marks are not supported inside a table cell: ${mark}`,
		capability: "marks",
		mark,
	});
}
