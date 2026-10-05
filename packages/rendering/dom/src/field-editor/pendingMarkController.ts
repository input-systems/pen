import type { Editor, SchemaRegistry } from "@input/pen-types";
import { resolveMarksAtPosition } from "./markBoundary";
import type { FieldEditorTextLike } from "./crdt";

type PendingMarkControllerOptions = {
	editor: Editor;
	getFocusBlockId: () => string | null;
	getYText: (blockId: string) => FieldEditorTextLike | null;
	emitStateChange: () => void;
};

export class PendingMarkController {
	private readonly editor: Editor;
	private readonly getFocusBlockId: () => string | null;
	private readonly getYText: (blockId: string) => FieldEditorTextLike | null;
	private readonly emitStateChange: () => void;
	private pendingMarks: Record<string, unknown | null> = {};

	constructor(options: PendingMarkControllerOptions) {
		this.editor = options.editor;
		this.getFocusBlockId = options.getFocusBlockId;
		this.getYText = options.getYText;
		this.emitStateChange = options.emitStateChange;
	}

	getSnapshot(): Readonly<Record<string, unknown | null>> {
		return this.pendingMarks;
	}

	reset(): void {
		this.pendingMarks = {};
	}

	clear(silent = false): void {
		if (Object.keys(this.pendingMarks).length === 0) return;
		this.pendingMarks = {};
		if (!silent) {
			this.emitStateChange();
		}
	}

	toggle(markType: string, isEditing: boolean, inputMode: string): boolean {
		if (!isEditing || inputMode !== "richtext") return false;

		const baseMarks = this.resolveBaseInsertMarks();
		const baseValue = baseMarks[markType];
		const effectiveMarks = this.applyPendingMarks(baseMarks);
		const nextValue = effectiveMarks[markType] != null ? null : true;
		const nextPendingMarks = { ...this.pendingMarks };

		if ((baseValue ?? null) === nextValue) {
			delete nextPendingMarks[markType];
		} else {
			nextPendingMarks[markType] = nextValue;
		}

		this.pendingMarks = nextPendingMarks;
		this.emitStateChange();
		return true;
	}

	resolveInsertMarks(
		ytext: FieldEditorTextLike,
		offset: number,
	): Record<string, unknown | null> | undefined {
		const baseMarks =
			resolveMarksAtPosition(ytext, offset, this.editor.schema) ?? {};
		const resolved = this.applyPendingMarks(baseMarks);
		const insertMarks: Record<string, unknown | null> = { ...resolved };

		for (const [markType, value] of Object.entries(this.pendingMarks)) {
			if (value == null && markType in baseMarks) {
				insertMarks[markType] = null;
			}
		}

		return Object.keys(insertMarks).length > 0 ? insertMarks : undefined;
	}

	private resolveBaseInsertMarks(): Record<string, unknown> {
		const selection = this.editor.selection;
		if (!this.getFocusBlockId() || selection?.type !== "text") {
			return {};
		}

		const blockId = selection.focus.blockId;
		const ytext = this.getYText(blockId);
		if (!ytext) return {};

		return (
			resolveMarksAtPosition(
				ytext,
				selection.focus.offset,
				this.editor.schema,
			) ?? {}
		);
	}

	private applyPendingMarks(
		baseMarks: Record<string, unknown>,
	): Record<string, unknown> {
		const nextMarks = { ...baseMarks };
		for (const [markType, value] of Object.entries(this.pendingMarks)) {
			if (value == null) {
				delete nextMarks[markType];
			} else {
				nextMarks[markType] = value;
			}
		}
		return nextMarks;
	}
}

/**
 * The marks the next insert at `offset` carries. A controller built against
 * the published types has no pending-mark part (`FieldEditorParts` is
 * internal); its inserts inherit the marks at the insert position, as they
 * did before pending marks existed.
 */
export function resolveFieldInsertMarks(
	pendingMarks: PendingMarkController | undefined,
	schema: SchemaRegistry,
	ytext: FieldEditorTextLike,
	offset: number,
): Record<string, unknown | null> | undefined {
	if (pendingMarks) {
		return pendingMarks.resolveInsertMarks(ytext, offset);
	}
	return resolveMarksAtPosition(ytext, offset, schema);
}
