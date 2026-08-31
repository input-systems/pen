"use client";

// ── @input/pen-react — React rendering layer for Pen ─────────────
//
// Package entry. Re-exports all public API:
// - Pen.* compound component namespace
// - Individual primitives
// - Hooks
// - Contexts (for advanced use)
// - Field editor internals (for extension authors)
// - Renderer registry
// - Utilities

// ── Convenience component ───────────────────────────────────
export { PenEditor, type PenEditorProps } from "./penEditor";

// ── Compound component namespace ────────────────────────────
export { Pen } from "./primitives/index";

// ── Editor primitives ───────────────────────────────────────
export {
	CARET,
	EditorRoot,
	EditorContent,
	EditorBlock,
	BlockChildren,
	InlineContent,
	EditorCaretOverlay,
	EditorBlockHandle,
	EditorDragOverlay,
	EditorRegionSelector,
	EditorSelectionRect,
	EditorFieldEditor,
	type EditorCaretVariant,
	type EditorRootProps,
	type InlineAtomInteractions,
	type InlineAtomRenderProps,
	type InlineAtomRenderInteractionProps,
	type InlineAtomRenderer,
	type InlineAtomRenderers,
	type EditorContentProps,
	type EditorBlockProps,
	type BlockChildrenProps,
	type InlineContentProps,
	type EditorCaretOverlayProps,
	type EditorCaretRenderProps,
	type BlockHandleProps,
	type DragOverlayProps,
	type RegionSelectorProps,
	type SelectionRectProps,
	type FieldEditorWrapperProps,
} from "./primitives/editor/index";

// ── Toolbar primitives ──────────────────────────────────────
export {
	ToolbarRoot,
	ToolbarGroup,
	ToolbarButton,
	ToolbarToggle,
	ToolbarSelect,
	ToolbarSeparator,
	type ToolbarRootProps,
	type ToolbarGroupProps,
	type ToolbarButtonProps,
	type ToolbarToggleProps,
	type ToolbarSelectProps,
	type ToolbarSeparatorProps,
} from "./primitives/toolbar/index";

// ── Slash menu primitives ───────────────────────────────────
export {
	SlashMenuRoot,
	SlashMenuContent,
	SlashMenuInput,
	SlashMenuList,
	SlashMenuGroup,
	SlashMenuItem,
	SlashMenuEmpty,
	useSlashMenuContext,
	type SlashMenuContextValue,
	type SlashMenuRootProps,
	type SlashMenuContentProps,
	type SlashMenuInputProps,
	type SlashMenuListProps,
	type SlashMenuGroupProps,
	type SlashMenuItemProps,
	type SlashMenuEmptyProps,
} from "./primitives/slash-menu/index";

// ── Suggestion menu primitives ───────────────────────────────
export {
	SuggestionMenuRoot,
	SuggestionMenuContent,
	SuggestionMenuList,
	SuggestionMenuGroup,
	SuggestionMenuItem,
	SuggestionMenuEmpty,
	useSuggestionMenuContext,
	type SuggestionMenuContextValue,
	type SuggestionMenuRootProps,
	type SuggestionMenuContentProps,
	type SuggestionMenuListProps,
	type SuggestionMenuGroupProps,
	type SuggestionMenuItemProps,
	type SuggestionMenuEmptyProps,
} from "./primitives/suggestion-menu/index";

// ── Selection toolbar primitives ────────────────────────────
export {
	SelectionToolbarRoot,
	SelectionToolbarContent,
	useSelectionToolbarContext,
	type SelectionToolbarRootProps,
	type SelectionToolbarContentProps,
	type SelectionToolbarContextValue,
} from "./primitives/selection-toolbar/index";

// ── Search primitives ────────────────────────────────────────
export {
	SearchRoot,
	SearchInput,
	SearchResults,
	SearchNext,
	SearchPrevious,
	SearchReplaceInput,
	SearchReplace,
	SearchReplaceAll,
	SearchCaseSensitive,
	SearchRegExpToggle,
	SearchWholeWord,
	useSearchContext,
	type SearchRootProps,
	type SearchInputProps,
	type SearchResultsProps,
	type SearchNavigationButtonProps,
	type SearchReplaceInputProps,
	type SearchReplaceButtonProps,
	type SearchToggleProps,
	type SearchContextValue,
} from "./primitives/search/index";

// ── AI primitives ────────────────────────────────────────────
export {
	AIRoot,
	AITrigger,
	AISelectionTrigger,
	AICommandMenu,
	AICommandInput,
	AICommandList,
	AICommandItem,
	AIGenerationZone,
	AIActionBar,
	AIAcceptButton,
	AIRejectButton,
	AIRetryButton,
	AISuggestion,
	AITrackChanges,
	AIDiffView,
	AIChangeList,
	AIProgress,
	AIToolStream,
	AIContextualPromptTrigger,
	AIContextualPromptSurface,
	AIContextualPromptComposer,
	AIInlineSuggestionControls,
	AIInlineSuggestionFloatingSurface,
	AIInlineSuggestionCount,
	AIInlineSuggestionPreviousButton,
	AIInlineSuggestionNextButton,
	AIInlineSuggestionAcceptButton,
	AIInlineSuggestionRejectButton,
	AIInlineSession,
	AIInlineSessionActions,
	useAIContext,
	type AIRootProps,
	type AITriggerProps,
	type AISelectionTriggerProps,
	type AICommandMenuProps,
	type AICommandInputProps,
	type AICommandListProps,
	type AICommandItemProps,
	type AIGenerationZoneProps,
	type AIActionBarProps,
	type AIAcceptButtonProps,
	type AIRejectButtonProps,
	type AIRetryButtonProps,
	type AISuggestionProps,
	type AITrackChangesProps,
	type AIDiffViewProps,
	type AIChangeListProps,
	type AIProgressProps,
	type AIToolStreamProps,
	type AIContextualPromptTriggerProps,
	type AIContextualPromptSurfaceProps,
	type AIContextualPromptComposerProps,
	type AIInlineSuggestionControlsProps,
	type AIInlineSuggestionFloatingSurfaceProps,
	type AIInlineSuggestionCountProps,
	type AIInlineSuggestionPreviousButtonProps,
	type AIInlineSuggestionNextButtonProps,
	type AIInlineSuggestionAcceptButtonProps,
	type AIInlineSuggestionRejectButtonProps,
	type AIInlineSessionProps,
	type AIInlineSessionActionsProps,
} from "./primitives/ai/index";
export {
	AISuggestionsRoot,
	AISuggestionsPopover,
	type AISuggestionsRootProps,
	type AISuggestionsPopoverProps,
} from "./primitives/aiSuggestions/index";
export {
	MultiplayerPresenceList,
	MultiplayerRemoteCursors,
	MultiplayerCaretOverlay,
	type MultiplayerPresenceListProps,
	type MultiplayerCaretOverlayProps,
	type MultiplayerCaretRenderProps,
	type MultiplayerRemoteCursorsProps,
} from "./primitives/multiplayer/index";

// ── Hooks ───────────────────────────────────────────────────
export {
	useAI,
	useAISuggestions,
	useAISuggestionPopover,
	useAISuggestionsMetrics,
	useAIDebugLog,
	useAISessions,
	useActiveAISession,
	useContextualPromptSession,
	useContextualPromptAnchor,
	useContextualPromptPlacement,
	useAIActions,
	useAISessionActions,
	useAttribution,
	useEditor,
	useEditorMessage,
	useFieldEditor,
	useEditorFocusController,
	useFocusController,
	useSnapshots,
	useSearch,
	useMultiplayer,
	useRemoteCursors,
	useRemoteSelections,
	useSelection,
	useDecorations,
	useGeneration,
	useSuggestions,
	useInlineSuggestionControls,
	useSuggestMode,
	useExtensionState,
	useToolbar,
	useSelectionToolbar,
	useSlashMenu,
	useSuggestionMenu,
	resolveSuggestionMenuTarget,
	useBlockList,
	useBlockDragHandle,
	type AIDebugLogEntry,
	type AIDebugLogCommitMetrics,
	type AIDebugLogState,
	type AttributionState,
	type PenFocusController,
	type PenFocusOptions,
	type PenFocusOffset,
	type PenRangeFocusRequest,
	type PenTextFocusRequest,
	type AISuggestionPopoverPosition,
	type ContextualPromptMode,
	type ContextualPromptPlacement,
	type ContextualPromptSide,
	type UseContextualPromptPlacementOptions,
	type InlineSuggestionControlPosition,
	type InlineSuggestionControlsState,
	type BlockDragHandleHookResult,
	type SelectionToolbarState,
	type SlashMenuState,
	type SlashMenuActions,
	type SlashMenuTarget,
	type SuggestionMenuActions,
	type SuggestionMenuBoundary,
	type SuggestionMenuController,
	type SuggestionMenuGetItemsOptions,
	type SuggestionMenuSelectOptions,
	type SuggestionMenuState,
	type SuggestionMenuStatus,
	type SuggestionMenuTarget,
	type SuggestionMenuTrigger,
	type UseSuggestionMenuOptions,
} from "./hooks/index";

// ── Contexts (for advanced composition) ─────────────────────
// EMPTY_TOOLBAR_STATE stays off the barrel. Hosts read toolbar state
// through useToolbar.
export {
	EditorContext,
	useEditorContext,
	FieldEditorContext,
	useFieldEditorContext,
	ToolbarContext,
	useToolbarContext,
	SelectionToolbarContext,
	type EditorContextValue,
	type BlockControlsProps,
	type BlockControlsRenderer,
	type BlockDragAndDropOptions,
	type BlockSelectionOptions,
	type ResolvedBlockDragAndDropOptions,
	type ResolvedBlockSelectionOptions,
	type ResolvedInteractionModel,
	type PasteImporters,
	type RendererOverrides,
	type ToolbarState,
	type ToolbarContextValue,
} from "./context/index";

// ── Renderer registry ───────────────────────────────────────
export {
	resolveRenderer,
	registerRenderer,
	ParagraphRenderer,
	HeadingRenderer,
	BulletListItemRenderer,
	NumberedListItemRenderer,
	CheckListItemRenderer,
	CodeBlockRenderer,
	ImageRenderer,
	TableRenderer,
	DividerRenderer,
	CalloutRenderer,
	ToggleRenderer,
	BlockquoteRenderer,
	SubdocumentRenderer,
	DefaultRenderer,
} from "./renderers/index";
export type { ListItemHostAttributes } from "./renderers/index";

// ── Extensions ───────────────────────────────────────────────
export {
	richTextShortcutsExtension,
	RICH_TEXT_SHORTCUTS_EXTENSION_NAME,
	type RichTextShortcutsOptions,
} from "@input/pen-shortcuts";

// Engine helpers live on `@input/pen-dom/field-editor`.
// `fullReconcileDeltasToDOM` is not on that first-class subpath.
export { fullReconcileDeltasToDOM } from "@input/pen-dom/field-editor/reconciler";

// ── Internal hooks (for extension authors) ──────────────────
export { useFieldEditorState } from "./hooks/useFieldEditorState";
export { useCellTextSnapshot } from "./hooks/useCellTextSnapshot";
export { useAIStreamEvents } from "./hooks/useAIStreamEvents";

// ── Table primitives (for extension authors) ────────────────
export {
	TableCellContent,
	type TableCellContentProps,
} from "./primitives/editor/tableCellContent";

// ── Utilities ───────────────────────────────────────────────
export { composeRefs } from "./utils/composeRefs";
export { renderAsChild, type AsChildProps } from "./utils/asChild";
export {
	DATA_ATTRS,
	buildDataAttributes,
} from "@input/pen-dom/utils/dataAttributes";
export {
	getAttachedFieldEditor,
	getAttachedFieldEditorStore,
} from "./utils/fieldEditor";
export type {
	FieldEditorFocusRequest,
	PenFocusAction,
	PenFocusDecision,
	PenFieldEditorFocusOptions,
	PenFocusLifecycleEvent,
	PenFocusLifecycleListener,
	PenFocusPolicy,
	PenFocusRequest,
	PenFocusReason,
} from "@input/pen-dom";
/** Inline-atom lookup and delete; same logical-offset domain as the caret. */
export { getInlineAtomAtOffset, removeInlineAtom } from "@input/pen-dom";
export { isCellInSelection } from "./utils/cellSelection";
export { resolveRemoteCellPresence } from "./utils/remoteCellSelection";
export type {
	RemoteCellPresence,
	RemoteCellPresenceMap,
} from "./utils/remoteCellSelection";

// ── Re-export key types from @input/pen-types for convenience ─────
export type {
	BlockRenderContext,
	BlockRenderer,
	BlockHandle,
	Editor,
	SelectionState,
	DecorationSet,
	Decoration,
	InlineDecoration,
	BlockDecoration,
	FieldEditor,
} from "@input/pen-types";

export type {
	BlameRange,
	CharacterAttribution,
	SnapshotsState,
} from "@input/pen-snapshots";
export type { MultiplayerState, PeerState } from "@input/pen-multiplayer";
/** A peer's rectangular cell selection inside a table grid. */
export type { RemoteCellSelectionState } from "@input/pen-multiplayer";
export type {
	RemoteCursorState,
	RemoteSelectionState,
} from "@input/pen-multiplayer";

export type { CreateEditorOptions } from "@input/pen-types";
