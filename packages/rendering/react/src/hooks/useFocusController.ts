import type { Editor } from "@input/pen-types";
import type { FieldEditorSession, PenFocusReason } from "@input/pen-dom";
import { getAttachedFieldEditor } from "../utils/fieldEditor";
import { useEditorContext } from "../context/editorContext";

export type PenFocusOffset = number | "start" | "end";

export type PenFocusOptions = {
	reason?: PenFocusReason;
	domFocus?: boolean;
	passive?: boolean;
};

export type PenTextFocusRequest = PenFocusOptions & {
	blockId: string;
	offset?: PenFocusOffset;
};

export type PenRangeFocusRequest = PenFocusOptions & {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
};

export type PenFocusController = {
	text(request: PenTextFocusRequest): Promise<boolean>;
	start(
		blockId: string,
		request?: Omit<PenTextFocusRequest, "blockId" | "offset">,
	): Promise<boolean>;
	end(
		blockId: string,
		request?: Omit<PenTextFocusRequest, "blockId" | "offset">,
	): Promise<boolean>;
	range(request: PenRangeFocusRequest): Promise<boolean>;
	restore(
		request: PenTextFocusRequest | PenRangeFocusRequest,
	): Promise<boolean>;
	blur(): void;
	waitForAttachment(blockId?: string | null): Promise<boolean>;
};

export function useEditorFocusController(): PenFocusController {
	const { editor } = useEditorContext();
	return useFocusController(editor);
}

export function useFocusController(editor: Editor): PenFocusController {
	const getFieldEditor = () =>
		getAttachedFieldEditor(editor) as FieldEditorSession | null;

	return {
		text: (request) => {
			const offset = resolveFocusOffset(
				editor,
				request.blockId,
				request.offset,
			);
			return focusRange(getFieldEditor, {
				blockId: request.blockId,
				anchorOffset: offset,
				focusOffset: offset,
				reason: request.reason,
				domFocus: request.domFocus,
				passive: request.passive,
			});
		},
		start: (blockId, request = {}) => {
			return focusRange(getFieldEditor, {
				blockId,
				anchorOffset: 0,
				focusOffset: 0,
				reason: request.reason,
				domFocus: request.domFocus,
				passive: request.passive,
			});
		},
		end: (blockId, request = {}) => {
			const offset = resolveFocusOffset(editor, blockId, "end");
			return focusRange(getFieldEditor, {
				blockId,
				anchorOffset: offset,
				focusOffset: offset,
				reason: request.reason,
				domFocus: request.domFocus,
				passive: request.passive,
			});
		},
		range: (request) =>
			focusRange(getFieldEditor, {
				blockId: request.blockId,
				anchorOffset: request.anchorOffset,
				focusOffset: request.focusOffset,
				reason: request.reason,
				domFocus: request.domFocus,
				passive: request.passive,
			}),
		restore: (request) => {
			if ("anchorOffset" in request) {
				return focusRange(getFieldEditor, {
					blockId: request.blockId,
					anchorOffset: request.anchorOffset,
					focusOffset: request.focusOffset,
					reason: request.reason,
					domFocus: request.domFocus,
					passive: request.passive,
				});
			}
			const offset = resolveFocusOffset(
				editor,
				request.blockId,
				request.offset,
			);
			return focusRange(getFieldEditor, {
				blockId: request.blockId,
				anchorOffset: offset,
				focusOffset: offset,
				reason: request.reason,
				domFocus: request.domFocus,
				passive: request.passive,
			});
		},
		blur: () => {
			getFieldEditor()?.blur();
		},
		waitForAttachment: (blockId) => {
			const fieldEditor = getFieldEditor();
			return fieldEditor?.waitForAttachment(blockId) ?? Promise.resolve(false);
		},
	};
}

function focusRange(
	getFieldEditor: () => FieldEditorSession | null,
	request: {
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
		reason?: PenFocusReason;
		domFocus?: boolean;
		passive?: boolean;
	},
): Promise<boolean> {
	const fieldEditor = getFieldEditor();
	if (!fieldEditor) {
		return Promise.resolve(false);
	}

	return fieldEditor.focusTextSelection(
		request.blockId,
		request.anchorOffset,
		request.focusOffset,
		{
			reason: request.reason,
			domFocus: request.domFocus,
			passive: request.passive ?? request.domFocus === false,
		},
	);
}

function resolveFocusOffset(
	editor: Editor,
	blockId: string,
	offset: PenFocusOffset = "end",
): number {
	if (typeof offset === "number") {
		return offset;
	}
	if (offset === "start") {
		return 0;
	}
	return editor.getBlock(blockId)?.length() ?? 0;
}
