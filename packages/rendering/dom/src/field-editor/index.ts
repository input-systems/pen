export type { FieldEditorStore, FieldEditorStoreSnapshot } from "./store";
export { applyDeltaToDOM, fullReconcileToDOM } from "./reconciler";
export { resolveMarksAtPosition } from "./markBoundary";
export {
	computeTextDiff,
	extractTextFromDOM,
	domSelectionToEditor,
	getSelectionOffsets,
	getCaretOffset,
	type SelectionPoint,
	type TextDiffOp,
} from "./selectionBridge";
export {
	INLINE_ATOM_LOGICAL_LENGTH,
	buildMoveInlineAtomOps,
	getInlineAtomAtOffset,
	moveInlineAtom,
	removeInlineAtom,
	replaceInlineAtomWithText,
	resolveInlineAtomDropTarget,
	type InlineAtomDropTarget,
	type InlineAtomSnapshot,
	type InlineAtomSource,
	type MoveInlineAtomOptions,
	type RemoveInlineAtomOptions,
	type ReplaceInlineAtomWithTextOptions,
	type ResolveInlineAtomDropTargetOptions,
} from "./inlineAtomInteraction";
export type {
	FieldEditorFocusReason,
	FieldEditorFocusRequest,
	PenFocusAction,
	PenFocusDecision,
	PenFieldEditorFocusOptions,
	PenFocusLifecycleEvent,
	PenFocusLifecycleListener,
	PenFocusPolicy,
	PenFocusRequest,
	PenFocusReason,
} from "./controller";
export {
	expandFieldEditorRange,
	contractFieldEditorRange,
	shouldUseBlockSelection,
	classifySelectionSurface,
	getExpandedBlockRole,
	type ExpandedBlockRole,
	type FieldEditorSurfaceMode,
	type FieldEditorSurfaceState,
} from "./crossBlock";
export {
	handlePaste,
	handleClipboardPaste,
	handleCopy,
	handleCut,
} from "./clipboard";
