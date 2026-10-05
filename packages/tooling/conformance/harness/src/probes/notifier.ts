import { fieldEditorHostFacet } from "@input/pen-core";
import type { BlockNotifier } from "@input/pen-dom/field-editor/store";
import type { Editor } from "@input/pen-types";

/**
 * W2.R1 notifier metrics: per-block deliveries in a probe window and live
 * block subscribers at mount, read from the mounted field editor's notifier.
 */
let editor: Editor | null = null;
let deliveriesAtBegin = 0;

function notifier(): BlockNotifier | null {
	const host = editor?.facet(fieldEditorHostFacet) as { blockNotifier?: BlockNotifier } | null | undefined;
	return host?.blockNotifier ?? null;
}

export function trackNotifierEditor(next: Editor): void {
	editor = next;
}

export function beginNotifierProbe(): void {
	deliveriesAtBegin = notifier()?.diagnostics.deliveries ?? 0;
}

export function endNotifierProbe(): Record<string, number> {
	const current = notifier();
	return current ? { "notifier.deliveries": current.diagnostics.deliveries - deliveriesAtBegin } : {};
}

export function liveNotifierSubscribers(): Record<string, number> {
	const current = notifier();
	return current ? { "notifier.blockSubscribers": current.diagnostics.blockSubscribers } : {};
}
