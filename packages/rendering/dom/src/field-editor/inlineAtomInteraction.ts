import { fieldEditorHostFacet } from "@input/pen-core";
import {
	type ApplyOptions,
	type DocumentOp,
	type Editor,
	type FieldEditor,
	type InlineDelta,
	type InlineNodeDeltaInsert,
	type SelectionOrigin,
} from "@input/pen-types";
import {
	pointToEditorSelectionPoint,
	type SelectionPoint,
} from "./selectionBridge";

export const INLINE_ATOM_LOGICAL_LENGTH = 1;

const OBJECT_REPLACEMENT_CHARACTER = "\uFFFC";
const DEFAULT_APPLY_OPTIONS: ApplyOptions = { origin: "user", undoGroup: true };

export interface InlineAtomSource {
	editor: Editor;
	blockId: string;
	offset: number;
}

export interface InlineAtomDropTarget {
	editor: Editor;
	blockId: string;
	offset: number;
}

export interface InlineAtomSnapshot {
	blockId: string;
	offset: number;
	type: string;
	props: Record<string, unknown>;
	text: string;
}

export interface InlineAtomRenderInteractionProps {
	draggable: boolean;
	dragging: boolean;
	canDestructure: boolean;
	canRemove: boolean;
	destructure?: () => boolean;
	remove?: () => boolean;
}

export type InlineAtomDestructureHandler = (
	atom: InlineAtomSnapshot,
) => string | null | undefined;

export interface InlineAtomMoveEvent {
	source: InlineAtomSource;
	target: InlineAtomDropTarget;
	atom: InlineAtomSnapshot;
}

export interface InlineAtomMoveRejectedEvent {
	source: InlineAtomSource;
	target?: InlineAtomDropTarget;
	atom?: InlineAtomSnapshot;
	reason:
		| "readonly"
		| "disabled"
		| "stale-source"
		| "missing-target"
		| "schema"
		| "policy"
		| "noop";
}

export interface InlineAtomAfterDestructureEvent {
	editor: Editor;
	atom: InlineAtomSnapshot;
	blockId: string;
	startOffset: number;
	endOffset: number;
	text: string;
}

export type InlineAtomAfterDestructureObserver = (
	event: InlineAtomAfterDestructureEvent,
) => void;

export type InlineAtomMoveObserver = (
	event: InlineAtomMoveEvent,
) => boolean | void;

export type InlineAtomMoveRejectedObserver = (
	event: InlineAtomMoveRejectedEvent,
) => void;

export type InlineAtomInteractions =
	| boolean
	| {
			drag?: boolean;
			destructure?:
				| boolean
				| InlineAtomDestructureHandler
				| Partial<Record<string, InlineAtomDestructureHandler>>;
			onBeforeMove?: InlineAtomMoveObserver;
			onMove?: InlineAtomMoveObserver;
			onMoveRejected?: InlineAtomMoveRejectedObserver;
			onAfterDestructure?: InlineAtomAfterDestructureObserver;
	  };

export interface ResolvedInlineAtomInteractions {
	drag: boolean;
	destructure:
		| boolean
		| InlineAtomDestructureHandler
		| Partial<Record<string, InlineAtomDestructureHandler>>;
	onBeforeMove?: InlineAtomMoveObserver;
	onMove?: InlineAtomMoveObserver;
	onMoveRejected?: InlineAtomMoveRejectedObserver;
	onAfterDestructure?: InlineAtomAfterDestructureObserver;
}

export function resolveInlineAtomInteractions(
	options?: InlineAtomInteractions,
): ResolvedInlineAtomInteractions {
	if (options === true) {
		return { drag: true, destructure: false };
	}
	if (!options) {
		return { drag: false, destructure: false };
	}

	return {
		drag: options.drag ?? false,
		destructure: options.destructure ?? false,
		onBeforeMove: options.onBeforeMove,
		onMove: options.onMove,
		onMoveRejected: options.onMoveRejected,
		onAfterDestructure: options.onAfterDestructure,
	};
}

export interface ResolveInlineAtomDropTargetOptions {
	editor: Editor;
	root: HTMLElement | null;
	clientX: number;
	clientY: number;
}

export interface MoveInlineAtomOptions {
	source: InlineAtomSource;
	target: InlineAtomDropTarget;
	apply?: ApplyOptions;
}

export interface ReplaceInlineAtomWithTextOptions {
	source: InlineAtomSource;
	text: string;
	selection?: "all" | "end" | "none";
	apply?: ApplyOptions;
	/** The selection write's origin (S3); `"programmatic"` when omitted. */
	origin?: SelectionOrigin;
}

export function getInlineAtomAtOffset(
	editor: Editor,
	source: Pick<InlineAtomSource, "blockId" | "offset">,
): InlineAtomSnapshot | null {
	const block = editor.getBlock(source.blockId);
	if (!block) {
		return null;
	}

	let offset = 0;
	for (const delta of block.inlineDeltas()) {
		const length = getInlineDeltaLength(delta);
		if (offset === source.offset && typeof delta.insert !== "string") {
			return {
				blockId: source.blockId,
				offset: source.offset,
				type: delta.insert.type,
				props: { ...delta.insert.props },
				text: getInlineAtomText(editor, delta.insert),
			};
		}

		offset += length;
	}

	return null;
}

export function resolveInlineAtomDropTarget({
	editor,
	root,
	clientX,
	clientY,
}: ResolveInlineAtomDropTargetOptions): InlineAtomDropTarget | null {
	if (!root) {
		return null;
	}

	const point = pointToEditorSelectionPoint(root, clientX, clientY);
	if (!point) {
		return null;
	}

	return {
		editor,
		blockId: point.blockId,
		offset: point.offset,
	};
}

export function buildMoveInlineAtomOps(
	editor: Editor,
	source: Pick<InlineAtomSource, "blockId" | "offset">,
	target: SelectionPoint,
): DocumentOp[] {
	const sourceAtom = getInlineAtomAtOffset(editor, source);
	if (
		!sourceAtom ||
		!editor.getBlock(target.blockId) ||
		isNoopInlineAtomMove(source, target)
	) {
		return [];
	}

	const targetOffset = getAdjustedTargetOffset(source, target);
	return [
		{
			type: "splice-text",
			blockId: source.blockId,
			from: source.offset,
			to: source.offset + INLINE_ATOM_LOGICAL_LENGTH,
			insert: "",
		},
		{
			type: "splice-text",
			blockId: target.blockId,
			from: targetOffset,
			to: targetOffset,
			insert: {
				nodeType: sourceAtom.type,
				props: { ...sourceAtom.props },
			},
		},
	];
}

export function moveInlineAtom({
	source,
	target,
	apply,
}: MoveInlineAtomOptions): boolean {
	if (source.editor === target.editor) {
		return moveInlineAtomWithinEditor({ source, target, apply });
	}

	return moveInlineAtomBetweenEditors({ source, target, apply });
}

export function replaceInlineAtomWithText({
	source,
	text,
	selection = "end",
	apply,
	origin = "programmatic",
}: ReplaceInlineAtomWithTextOptions): boolean {
	const sourceAtom = getInlineAtomAtOffset(source.editor, source);
	if (!sourceAtom) {
		return false;
	}

	const ops: DocumentOp[] = [
		{
			type: "splice-text",
			blockId: source.blockId,
			from: source.offset,
			to: source.offset + INLINE_ATOM_LOGICAL_LENGTH,
			insert: "",
		},
	];
	if (text.length > 0) {
		ops.push({
			type: "splice-text",
			blockId: source.blockId,
			from: source.offset,
			to: source.offset,
			insert: text,
		});
	}

	source.editor.apply(ops, apply ?? DEFAULT_APPLY_OPTIONS);

	const endOffset = source.offset + text.length;

	if (selection === "all") {
		source.editor.selectText(source.blockId, source.offset, endOffset, {
			origin,
		});
	} else if (selection === "end") {
		source.editor.selectText(source.blockId, endOffset, endOffset, {
			origin,
		});
	}

	const fieldEditor = source.editor.facet(
		fieldEditorHostFacet,
	) as FieldEditor | null;
	if (fieldEditor && selection !== "none") {
		if (selection === "all") {
			if (typeof fieldEditor.activateTextSelection === "function") {
				fieldEditor.activateTextSelection(
					source.blockId,
					source.offset,
					endOffset,
					{ origin },
				);
			} else {
				fieldEditor.activate(source.blockId);
			}
		} else if (selection === "end") {
			if (typeof fieldEditor.activateTextSelection === "function") {
				fieldEditor.activateTextSelection(
					source.blockId,
					endOffset,
					endOffset,
					{ origin },
				);
			} else {
				fieldEditor.activate(source.blockId);
			}
		}
		fieldEditor.focus();
	}

	return true;
}

/**
 * Options for {@link removeInlineAtom}.
 *
 * `source.offset` is logical: the atom occupies one unit, the same domain as
 * caret offsets and `block.length()`.
 */
export interface RemoveInlineAtomOptions {
	/** Editor, block, and logical offset of the atom to delete. Required. */
	source: InlineAtomSource;
	/**
	 * Where to place the caret after a successful delete.
	 * `"end"` collapses at the hole; `"none"` leaves selection untouched.
	 * @default "end"
	 */
	selection?: "end" | "none";
	/**
	 * Passed through to `editor.apply`.
	 * @default { origin: "user", undoGroup: true }
	 */
	apply?: ApplyOptions;
}

/**
 * Deletes the inline atom at a logical offset and leaves surrounding text.
 *
 * A stale offset (no atom at `source.offset`) is a no-op so a renderer click
 * cannot eat a neighboring character.
 *
 * @param options - Source position plus optional selection and apply overrides.
 *   See {@link RemoveInlineAtomOptions} for field defaults.
 * @returns `true` when the atom was deleted; `false` when the offset was stale
 *   or the block is gone.
 * @throws Never. Stale or missing atoms return `false`.
 */
export function removeInlineAtom({
	source,
	selection = "end",
	apply,
}: RemoveInlineAtomOptions): boolean {
	return replaceInlineAtomWithText({
		source,
		text: "",
		selection,
		apply,
	});
}

function moveInlineAtomWithinEditor({
	source,
	target,
	apply,
}: MoveInlineAtomOptions): boolean {
	const ops = buildMoveInlineAtomOps(source.editor, source, target);
	if (ops.length === 0) {
		return false;
	}

	const targetOffset = getAdjustedTargetOffset(source, target);
	source.editor.apply(ops, apply ?? DEFAULT_APPLY_OPTIONS);
	// S3: an atom move is a drag and drop.
	source.editor.selectText(
		target.blockId,
		targetOffset + INLINE_ATOM_LOGICAL_LENGTH,
		targetOffset + INLINE_ATOM_LOGICAL_LENGTH,
		{ origin: "pointer" },
	);
	return true;
}

function moveInlineAtomBetweenEditors({
	source,
	target,
	apply,
}: MoveInlineAtomOptions): boolean {
	const sourceAtom = getInlineAtomAtOffset(source.editor, source);
	if (
		!sourceAtom ||
		!target.editor.getBlock(target.blockId) ||
		!canInsertInlineAtom(target.editor, sourceAtom)
	) {
		return false;
	}

	const applyOptions = apply ?? DEFAULT_APPLY_OPTIONS;
	target.editor.apply(
		[
			{
				type: "splice-text",
				blockId: target.blockId,
				from: target.offset,
				to: target.offset,
				insert: {
					nodeType: sourceAtom.type,
					props: { ...sourceAtom.props },
				},
			},
		],
		applyOptions,
	);
	source.editor.apply(
		[
			{
				type: "splice-text",
				blockId: source.blockId,
				from: source.offset,
				to: source.offset + INLINE_ATOM_LOGICAL_LENGTH,
				insert: "",
			},
		],
		applyOptions,
	);
	target.editor.selectText(
		target.blockId,
		target.offset + INLINE_ATOM_LOGICAL_LENGTH,
		target.offset + INLINE_ATOM_LOGICAL_LENGTH,
		{ origin: "pointer" },
	);
	return true;
}

function canInsertInlineAtom(
	editor: Editor,
	atom: Pick<InlineAtomSnapshot, "type">,
): boolean {
	return editor.schema.resolveInline(atom.type)?.kind === "node";
}

function isNoopInlineAtomMove(
	source: Pick<InlineAtomSource, "blockId" | "offset">,
	target: Pick<InlineAtomDropTarget, "blockId" | "offset">,
): boolean {
	const sourceEndOffset = source.offset + INLINE_ATOM_LOGICAL_LENGTH;
	return (
		target.blockId === source.blockId &&
		target.offset >= source.offset &&
		target.offset <= sourceEndOffset
	);
}

function getAdjustedTargetOffset(
	source: Pick<InlineAtomSource, "blockId" | "offset">,
	target: Pick<InlineAtomDropTarget, "blockId" | "offset">,
): number {
	return target.blockId === source.blockId && target.offset > source.offset
		? target.offset - INLINE_ATOM_LOGICAL_LENGTH
		: target.offset;
}

function getInlineDeltaLength(delta: InlineDelta): number {
	return typeof delta.insert === "string"
		? delta.insert.replaceAll(OBJECT_REPLACEMENT_CHARACTER, "").length
		: INLINE_ATOM_LOGICAL_LENGTH;
}

function getInlineAtomText(
	editor: Editor,
	atom: InlineNodeDeltaInsert,
): string {
	return (
		editor.schema
			.resolveInline(atom.type)
			?.serialize.toMarkdown?.("", atom.props) ?? ""
	);
}
