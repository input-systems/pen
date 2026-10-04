import type {
	Editor,
	PenStreamPart,
	PenStreamRequest,
	Position,
	ToolContext,
} from "@input/pen-types";
import { generateId } from "@input/pen-types";

/**
 * The tool context both transports hand to tool handlers: block writes
 * emit their stream part and then apply to the in-process editor with
 * origin `ai`.
 */
export function createTransportToolContext(
	context: PenStreamRequest["context"],
	emit: (part: PenStreamPart) => void,
	editor: Editor | undefined,
): ToolContext {
	let activeZoneId: string | null = null;

	return {
		get editor(): Editor {
			return requireTransportEditor(editor);
		},
		docId: context?.docId ?? "",
		emit,
		insertBlock(
			blockType: string,
			props: Record<string, unknown>,
			position: Position,
		): string {
			const liveEditor = requireTransportEditor(editor);
			const blockId = generateId();

			emit({
				type: "block-insert",
				blockId,
				blockType,
				props,
				position,
			});

			liveEditor.apply(
				[{ type: "insert-block", blockId, blockType, props, position }],
				{ origin: "ai" },
			);

			return blockId;
		},
		updateBlock(blockId: string, props: Record<string, unknown>): void {
			const liveEditor = requireTransportEditor(editor);

			emit({ type: "block-update", blockId, props });
			liveEditor.apply([{ type: "set-props", blockId, props }], {
				origin: "ai",
			});
		},
		deleteBlock(blockId: string): void {
			const liveEditor = requireTransportEditor(editor);

			emit({ type: "block-delete", blockId });
			liveEditor.apply([{ type: "delete-block", blockId }], {
				origin: "ai",
			});
		},
		beginStreaming(zoneId: string, blockId: string): void {
			activeZoneId = zoneId;
			emit({ type: "gen-start", zoneId, blockId });
		},
		appendDelta(delta: string): void {
			if (!activeZoneId) {
				throw new Error("appendDelta() called before beginStreaming()");
			}
			emit({ type: "gen-delta", zoneId: activeZoneId, delta });
		},
		endStreaming(status: "complete" | "cancelled" | "error"): void {
			if (!activeZoneId) {
				throw new Error(
					"endStreaming() called before beginStreaming()",
				);
			}
			emit({ type: "gen-end", zoneId: activeZoneId, status });
			activeZoneId = null;
		},
	};
}

function requireTransportEditor(editor: Editor | undefined): Editor {
	if (editor) {
		return editor;
	}
	throw new Error("Transport tool context requires a valid editor");
}
