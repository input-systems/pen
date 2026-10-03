import { isCollapsed } from "@input/pen-core";
import type {
	DiagnosticEvent,
	SelectionRecord,
	SelectionState
} from "@input/pen-types";
import type {
	SerializedDiagnostic,
	SerializedSelection,
	SerializedSelectionRecord
} from "../../src/types";

/** Snapshot `isCollapsed` via the official helper — never copy a live field. */
export function serializeSelection(
	selection: SelectionState,
): SerializedSelection {
	if (selection == null) {
		return null;
	}

	switch (selection.type) {
		case "text":
			return {
				type: "text",
				anchor: {
					blockId: selection.anchor.blockId,
					offset: selection.anchor.offset
				},
				focus: {
					blockId: selection.focus.blockId,
					offset: selection.focus.offset
				},
				isCollapsed: isCollapsed(selection),
			};
		case "block":
			return {
				type: "block",
				blockIds: [...selection.blockIds]
			};
		case "app":
			return {
				type: "app",
				appId: selection.appId
			};
		case "cell":
			return {
				type: "cell",
				blockId: selection.blockId,
				anchor: { ...selection.anchor },
				head: { ...selection.head },
				...(selection.text ? { text: { ...selection.text } } : {}),
			};
		default: {
			const _exhaustive: never = selection;
			return _exhaustive;
		}
	}
}

export function serializeSelectionRecord(
	record: SelectionRecord | null,
): SerializedSelectionRecord | null {
	if (record == null) {
		return null;
	}
	const state = record.state;
	let serialized: SerializedSelection = null;
	if (state != null) {
		switch (state.type) {
			case "text":
				serialized = {
					type: "text",
					anchor: {
						blockId: state.anchor.blockId,
						offset: state.anchor.offset
					},
					focus: {
						blockId: state.focus.blockId,
						offset: state.focus.offset
					},
					isCollapsed:
						state.anchor.blockId === state.focus.blockId &&
						state.anchor.offset === state.focus.offset,
				};
				break;
			case "block":
				serialized = {
					type: "block",
					blockIds: [...state.blockIds]
				};
				break;
			case "app":
				serialized = {
					type: "app",
					appId: state.appId
				};
				break;
			case "cell":
				serialized = {
					type: "cell",
					blockId: state.blockId,
					anchor: { ...state.anchor },
					head: { ...state.head },
					...(state.text ? { text: { ...state.text } } : {}),
				};
				break;
			default: {
				const _exhaustive: never = state;
				return _exhaustive;
			}
		}
	}
	return {
		version: record.version,
		origin: record.origin,
		commitId: record.commitId,
		state: serialized
	};
}

export function serializeDiagnostic(
	event: DiagnosticEvent,
): SerializedDiagnostic {
	const details = primitiveDetails(event);
	return {
		code: event.code,
		level: event.level,
		source: event.source,
		message: event.message,
		...(typeof event.reason === "string" ? { reason: event.reason } : {}),
		...(details ? { details } : {}),
	};
}

const BASE_DIAGNOSTIC_KEYS = new Set(["code", "level", "source", "message", "reason"]);

/** The diagnostic's extra primitive fields, or undefined when it has none. */
function primitiveDetails(
	event: DiagnosticEvent,
): Record<string, string | number | boolean> | undefined {
	const details: Record<string, string | number | boolean> = {};
	for (const [key, value] of Object.entries(event)) {
		if (BASE_DIAGNOSTIC_KEYS.has(key)) continue;
		if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
			details[key] = value;
		}
	}
	return Object.keys(details).length > 0 ? details : undefined;
}
