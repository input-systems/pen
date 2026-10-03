export { FieldEditorImpl } from "./field-editor/fieldEditorImpl";
export {
	mountEditor,
	type MountEditorOptions,
	type MountedEditor,
} from "./host/mountEditor";
export {
	handleFieldEditorPointerActivate,
	type FieldEditorPointerActivateOptions,
	type FieldEditorPointerTarget,
} from "./host/pointerActivation";
export {
	handleFieldEditorRootFocus,
	type FieldEditorRootFocusOptions,
} from "./host/rootFocus";
export type {
	FieldEditorFocusReason,
	FieldEditorFocusRequest,
	FieldEditorSession,
	PenFocusAction,
	PenFocusDecision,
	PenFieldEditorFocusOptions,
	PenFocusLifecycleEvent,
	PenFocusLifecycleListener,
	PenFocusPolicy,
	PenFocusRequest,
	PenFocusReason,
} from "./field-editor/controller";
export {
	attachInlineAtomWrapperInteractions,
	getInlineAtomDragSnapshot,
	getInlineAtomRenderInteractionProps,
	isInlineAtomDragSource,
	registerInlineAtomInteractionRoot,
	resolveShiftClickInlineAtomSelection,
	subscribeInlineAtomDragSnapshot,
	type InlineAtomDragSnapshot,
	type InlineAtomWrapperInteractionOptions,
} from "./field-editor/inlineAtomWrapperInteractions";
export {
	canDestructure,
	destructureInlineAtom,
	selectInlineAtomRangeFromShiftClick,
} from "./field-editor/inlineAtomDestructure";
export {
	getInlineAtomAtOffset,
	removeInlineAtom,
} from "./field-editor/inlineAtomInteraction";
export { attachContentGestures } from "./field-editor/contentGestures";
export type {
	AttachContentGesturesOptions,
	ContentGestureRegionGesture,
	ContentGestureState,
	GestureSlot,
} from "./field-editor/contentGestures";
export {
	RegionSelectionStore,
	createRegionSelectionRect,
	intersectRegionSelectionRect,
	resolveRegionRect,
} from "./utils/regionSelection";
export type {
	RegionSelectionRect,
	RegionSelectionSnapshot,
	RegionSelectorActivation,
	RegionSelectorConfig,
	RegionSelectorSelectionMode,
} from "./utils/regionSelection";
export {
	bindEditorDocumentKeyDown,
	handleEditorDocumentKeyDown,
} from "./utils/documentShortcuts";
export type { BindEditorDocumentKeyDownOptions } from "./utils/documentShortcuts";
export { handleEscapeSelectionTransition } from "./utils/escapeSelection";
export { handleTableCellSelectionKeyDown } from "./utils/tableCellNavigation";
export {
	getClosestEditorRoot,
	isActiveFieldEditorTextEntryTarget,
	isFieldEditorTextEditingKey,
	isFieldEditorTextEntryTarget,
	isNativeTextEntryTarget,
	isTextEntryTarget,
	shouldHandleEditorKeyboardEvent,
} from "./utils/textEntryTarget";
export {
	DEFAULT_SELECT_ALL_BEHAVIOR,
	resolveSelectAllBehavior,
	type EditorSelectAllBehavior,
} from "./constants/selectAll";
export type { PasteImporters } from "./types/paste";
export {
	resolveBlockTextAlignment,
	type BlockTextAlignment,
} from "./utils/blockTextAlignment";
export {
	urlPolicy,
	type UrlContext,
	type UrlPolicy,
} from "./security/urlPolicy";
export {
	resolveEditorUrl,
	urlPolicyFromEditor,
} from "./security/resolveEditorUrl";
export { urlPolicyExtension } from "./security/urlPolicyExtension";
export {
	AX6_MOTION_MAPPING,
	REDUCED_MOTION_ATTR,
	createReducedMotionSignal,
	getRootReducedMotion,
} from "./a11y/motion";
export type { ReducedMotionListener, ReducedMotionSignal } from "./a11y/motion";
export { captureFocusReturn, restoreFocusReturn } from "./a11y/focusReturn";
export type {
	FocusReturnFieldEditor,
	FocusReturnOptions,
	FocusReturnPreference,
	FocusReturnResult,
	FocusReturnToken,
} from "./a11y/focusReturn";
export { DomScheduler } from "./scheduler";
export type {
	DomSchedulerDiagnostics,
	DomSchedulerOptions,
	DomSchedulerOwner,
	DomSchedulerPhase,
	FlushCollect,
	GeometryInvalidator,
	OverlayPainter,
} from "./scheduler";
export { getRootOverlay } from "./overlay/rootOverlay";
export { overlayItemStyle, overlayLabelStyle } from "./overlay/overlayStyles";
export {
	attachRemoteCarets,
	getRemoteCaretSource,
	REMOTE_CARET_CONTRIBUTOR,
	remoteCaretKey,
} from "./overlay/remoteCarets";
export type {
	AttachRemoteCaretsOptions,
	RemoteCaretCursor,
	RemoteCaretSource,
	RemoteCaretUser,
} from "./overlay/remoteCarets";
export type {
	OverlayCaretVariant,
	OverlayInlineStyle,
} from "./overlay/overlayStyles";
export type {
	OverlayCaretRole,
	OverlayCellCoord,
	OverlayContributor,
	OverlayFieldState,
	OverlayItemKind,
	OverlayPaintItem,
	OverlayPaintMode,
	OverlayPaintPlan,
	OverlayReadContext,
	OverlayRequest,
	RootOverlay,
} from "./overlay/types";
export {
	collapsedRect,
	createGeometryReader,
	getRootGeometry,
	measureWithRoot,
	registerVerticalCaretMeasure,
	singleRunLineBox,
	verticalCaretTarget,
} from "./geometry";
export type {
	Affinity,
	BidiRun,
	BidiRunGeometry,
	GeometryMeasureAdapter,
	GeometryReader,
	GeometryReaderHost,
	GeometryReaderOptions,
	LineBox,
	Point,
	Rect,
	RootGeometry,
	VerticalCaretTarget,
	VerticalDirection,
} from "./geometry";

// The review surface's styling contract (RS4): one sheet here, and the class
// vocabulary it styles stays exported once, from `@input/pen-types`.
export { PEN_REVIEW_STYLESHEET } from "./styles/reviewStylesheet";
export {
	adoptEditorChrome,
	EDITOR_CHROME_CUSTOM_PROPERTIES,
	PEN_EDITOR_CHROME_STYLESHEET,
} from "./styles/editorChrome";
