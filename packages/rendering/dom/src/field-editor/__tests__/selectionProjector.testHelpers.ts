import type { DiagnosticEvent, Point, SelectionRecord } from "@input/pen-types";
import {
	SelectionProjector,
	type SelectionProjectorOptions,
} from "../selectionProjector";
import {
	CLOSED_GESTURE_WINDOWS,
	nextGestureWindowState,
	type GestureEventKind,
} from "../selectionReader";

/** A text record from `anchor` to `focus` (collapsed when `focus` is omitted). */
export function textRecord(
	anchor: Point,
	focus: Point = anchor,
	overrides: Partial<Omit<SelectionRecord, "state">> = {},
): SelectionRecord {
	return {
		state: {
			type: "text",
			anchor,
			focus,
			affinity: "downstream",
			goalX: null,
		},
		version: 1,
		origin: "programmatic",
		commitId: 0,
		...overrides,
	};
}

/**
 * A projector over a mounted `first` field: every port succeeds, writes are
 * counted, and `ports` replaces any of them. `gesture` delivers an input as
 * the reader does: windows first, then the projector.
 */
export function createTestProjector(
	ports: Partial<SelectionProjectorOptions> = {},
	initialRecord: SelectionRecord | null = textRecord({
		blockId: "first",
		offset: 2,
	}),
) {
	const element = document.createElement("span");
	document.body.append(element);
	const diagnostics: DiagnosticEvent[] = [];
	const calls = { backendWrites: 0 };
	let record = initialRecord;
	let windows = CLOSED_GESTURE_WINDOWS;
	const projector = new SelectionProjector({
		getGestureWindows: () => windows,
		isEditing: () => true,
		getMode: () => "single",
		getFocusBlockId: () => "first",
		getAttachedElement: () => element,
		getRootElement: () => document.body,
		findExpandedHost: () => null,
		resolveInlineElement: () => element,
		attachElement: () => true,
		requestDomFocus: () => true,
		updateBackendSelection: () => {
			calls.backendWrites += 1;
		},
		setTextSelection: () => {},
		activate: () => {},
		emitSelectionProjected: () => {},
		getRecord: () => record,
		emitDiagnostic: (event) => diagnostics.push(event),
		...ports,
	});
	const gesture = (kind: GestureEventKind) => {
		windows = nextGestureWindowState(kind, windows);
		projector.onGesture(kind);
	};
	return {
		projector,
		element,
		diagnostics,
		calls,
		gesture,
		setRecord: (next: SelectionRecord | null) => {
			record = next;
		},
	};
}
