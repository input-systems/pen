import type { Editor, SchemaRegistry, SelectionOrigin } from "@input/pen-types";
import { resolveMarksAtPosition } from "./markBoundary";
import type { FieldEditorTextLike } from "./crdt";

/**
 * Selection changes that carry the caret along with an edit (typing,
 * deleting, composing, repair). Pending marks follow those; any other move
 * to a new caret position drops them, so a mark toggled at one caret does
 * not apply to text typed somewhere else.
 */
const PENDING_MARK_FOLLOW_ORIGINS: ReadonlySet<SelectionOrigin> = new Set([
	"mapped",
	"ime",
	"gc",
]);

/** A collapsed caret and the non-extending marks on the character before it. */
type CaretContext = {
	blockId: string;
	offset: number;
	edgeMarks: Record<string, unknown>;
};

/**
 * Non-extending marks (link, inline code) whose run end was just deleted,
 * pending for as many characters as were deleted, so retyping a typo at the
 * end of a link puts the new characters back inside it.
 */
type MarkRejoin = {
	marks: Record<string, unknown>;
	remaining: number;
};

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
	private pendingCaret: string | null = null;
	private lastCaret: CaretContext | null = null;
	private rejoin: MarkRejoin | null = null;

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
		this.pendingCaret = null;
		this.lastCaret = null;
		this.rejoin = null;
	}

	clear(silent = false): void {
		if (Object.keys(this.pendingMarks).length === 0) return;
		this.pendingMarks = {};
		this.pendingCaret = null;
		this.rejoin = null;
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
		this.pendingCaret = this.caretKey();
		this.emitStateChange();
		return true;
	}

	/**
	 * The selection is no longer a single-block caret: pending marks end, and
	 * the next caret starts without a previous one to compare against.
	 */
	releaseCaret(): void {
		this.clear(true);
		this.lastCaret = null;
	}

	/**
	 * Ends `markTypes` at the caret, so the next typed text does not extend
	 * them. An inline input rule that just turned `**bold**` into bold text
	 * leaves the caret after it, where an expanding mark would otherwise
	 * carry on into whatever is typed next.
	 */
	// fallow-ignore-next-line unused-class-member
	endMarks(markTypes: readonly string[]): void {
		if (markTypes.length === 0) return;
		const nextPendingMarks = { ...this.pendingMarks };
		for (const markType of markTypes) {
			nextPendingMarks[markType] = null;
		}
		this.pendingMarks = nextPendingMarks;
		this.pendingCaret = this.caretKey();
		this.emitStateChange();
	}

	/**
	 * Called for every collapsed single-block caret change. A caret moved by
	 * an edit carries the pending marks with it; a caret moved anywhere else
	 * (arrow keys, a click, a host `selectText`) drops them, while one
	 * re-asserted at the same position (focus returning from a toolbar)
	 * keeps them.
	 */
	followCaret(origin: SelectionOrigin): void {
		const previous = this.lastCaret;
		const current = this.readCaretContext();
		this.lastCaret = current;
		if (origin === "mapped") {
			this.trackEdit(previous, current);
		}

		if (Object.keys(this.pendingMarks).length === 0) return;
		const caret = this.caretKey();
		if (PENDING_MARK_FOLLOW_ORIGINS.has(origin)) {
			this.pendingCaret = caret;
			return;
		}
		if (caret !== this.pendingCaret) {
			this.clear(true);
		}
	}

	resolveInsertMarks(
		ytext: FieldEditorTextLike,
		offset: number,
	): Record<string, unknown | null> {
		const baseMarks =
			resolveMarksAtPosition(ytext, offset, this.editor.schema) ?? {};
		const resolved = this.applyPendingMarks(baseMarks);
		const insertMarks: Record<string, unknown | null> = { ...resolved };

		for (const [markType, value] of Object.entries(this.pendingMarks)) {
			if (value == null && markType in baseMarks) {
				insertMarks[markType] = null;
			}
		}

		return insertMarks;
	}

	/** An edit moved the caret within its block: a deletion may arm a rejoin, an insert consumes one. */
	private trackEdit(
		previous: CaretContext | null,
		current: CaretContext | null,
	): void {
		if (!previous || !current || previous.blockId !== current.blockId) {
			return;
		}
		const moved = current.offset - previous.offset;
		if (moved < 0) {
			this.armRejoin(previous, current, -moved);
		} else if (moved > 0) {
			this.consumeRejoin(moved);
		}
	}

	/**
	 * A deletion that ended at a non-extending mark's run end and left that
	 * run in place (the left neighbour still carries it, the right one does
	 * not) took the run's tail: the next characters typed rejoin it, up to as
	 * many as were deleted.
	 */
	private armRejoin(
		previous: CaretContext,
		current: CaretContext,
		deleted: number,
	): void {
		const right = this.marksOfCharacter(current.blockId, current.offset);
		const marks: Record<string, unknown> = {};
		for (const [markType, value] of Object.entries(previous.edgeMarks)) {
			if (
				sameMarkValue(current.edgeMarks[markType], value) &&
				!sameMarkValue(right[markType], value)
			) {
				marks[markType] = value;
			}
		}
		if (Object.keys(marks).length === 0) return;
		this.rejoin = {
			marks,
			remaining: deleted + (this.rejoin?.remaining ?? 0),
		};
		this.pendingMarks = { ...this.pendingMarks, ...marks };
	}

	private consumeRejoin(inserted: number): void {
		const rejoin = this.rejoin;
		if (!rejoin) return;
		rejoin.remaining -= inserted;
		if (rejoin.remaining > 0) return;
		this.rejoin = null;
		const nextPendingMarks = { ...this.pendingMarks };
		for (const [markType, value] of Object.entries(rejoin.marks)) {
			if (sameMarkValue(nextPendingMarks[markType], value)) {
				delete nextPendingMarks[markType];
			}
		}
		this.pendingMarks = nextPendingMarks;
	}

	private readCaretContext(): CaretContext | null {
		const selection = this.editor.selection;
		if (selection?.type !== "text") return null;
		const { blockId, offset } = selection.focus;
		const edgeMarks: Record<string, unknown> = {};
		for (const [markType, value] of Object.entries(
			this.marksOfCharacter(blockId, offset - 1),
		)) {
			const expand =
				this.editor.schema.resolveInline(markType)?.expand ?? "after";
			if (expand !== "after" && expand !== "both") {
				edgeMarks[markType] = value;
			}
		}
		return { blockId, offset, edgeMarks };
	}

	private marksOfCharacter(
		blockId: string,
		index: number,
	): Record<string, unknown> {
		if (index < 0) return {};
		const ytext = this.getYText(blockId);
		if (!ytext) return {};
		let start = 0;
		for (const delta of ytext.toDelta()) {
			const length =
				typeof delta.insert === "string" ? delta.insert.length : 1;
			if (index < start + length) {
				return delta.attributes ?? {};
			}
			start += length;
		}
		return {};
	}

	private caretKey(): string | null {
		const selection = this.editor.selection;
		if (selection?.type !== "text") return null;
		return `${selection.focus.blockId}:${selection.focus.offset}`;
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

function sameMarkValue(left: unknown, right: unknown): boolean {
	return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The marks the next insert at `offset` carries. A controller built against
 * the published types has no pending-mark part (`FieldEditorParts` is
 * internal); its inserts take the marks the expand policy allows at the
 * insert position, as they did before pending marks existed.
 *
 * The result is always explicit: an insert op without marks inherits the
 * CRDT left neighbour's formatting, which would extend a link or inline
 * code that the expand policy just excluded.
 */
export function resolveFieldInsertMarks(
	pendingMarks: PendingMarkController | undefined,
	schema: SchemaRegistry,
	ytext: FieldEditorTextLike,
	offset: number,
): Record<string, unknown | null> {
	if (pendingMarks) {
		return pendingMarks.resolveInsertMarks(ytext, offset);
	}
	return resolveMarksAtPosition(ytext, offset, schema) ?? {};
}
