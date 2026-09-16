import {
	filterOpsForDocumentProfile,
	filterPendingBlocksForDocumentProfile,
	createImportResult,
	getBlockContentRole,
	getBlockSelectionRoleFromSchema,
	getBlockSelectionRoleFromType,
	getFlowCapabilityFromSchema,
	getFlowCapabilityFromType,
	isContinuousTextFlowCapability,
	normalizePendingBlocksForImport,
	reportPendingBlockImportViolations,
	reportPendingBlockProfileViolations,
	resolveBlockFlowCapability,
	shouldAllowDirectBlockPaste,
	shouldAllowFlowInsertionInSlashMenu,
	shouldExposeBlockInTooling,
	shouldShowBlockInDefaultMenus,
	shouldForceBlockScopedSelectAll,
} from "./editor/profilePolicy";

// Contracts live in @input/pen-types.
// Keep @input/pen-core focused on runtime entrypoints and advanced internals.

// Schema engine runtime
export { SchemaRegistryImpl, mergeSchemas } from "./schema/registry";
export type { SchemaRegistryConfig } from "./schema/registry";
export {
	orderSlashMenuItemsByGroup,
	slashMenuGroupOf,
} from "./schema/slashMenuOrder";
export { defineBlock } from "./schema/defineBlock";
export type { DefinedBlockSchema } from "./schema/defineBlock";
export { defineExtension } from "./schema/defineExtension";
export { prop, resolveSchema } from "./schema/prop";
export { createEmptySchema, resolveEditorSchema } from "./schema/emptySchema";

export {
	SchemaEngineImpl,
	deepEqual,
	sortDeltaAttributes,
} from "./schema/normalize";

export { createBlockHandle, createAppHandle } from "./schema/handles";

export { suggestion } from "./schema/system-marks/suggestion";

// Editor runtime
export { createEditor, createHeadlessEditor } from "./editor/editor";
export type { CreateHeadlessEditorOptions } from "./editor/editor";
export { createDocumentSession } from "./editor/documentSession";
// DocumentSessionImpl stays off the barrel; the factory returns DocumentSession from @input/pen-types.
export { EventEmitter } from "./editor/events";
export {
	createDecorationSet,
	emptyDecorationSet,
	mergeDecorationSets,
} from "./editor/decorations";
export {
	ensureInlineCompletionController,
	getInlineCompletionController,
} from "./editor/inlineCompletion";
// DocumentStateImpl stays off the barrel; hosts read editor.documentState (DocumentState from @input/pen-types).
export { DocumentRangeImpl } from "./editor/range";
export { SelectionAuthorityImpl as SelectionAuthority } from "./editor/selection";
export { deriveContentMoves, repairAnchor } from "./editor/anchorRepair";
export type { ContentMove } from "./editor/anchorRepair";
export { getEditorSelectionRecord } from "./editor/selectionRecord";
export {
	createTextSelection,
	getSelectionBlockRange,
	isBlockSelected,
	isCollapsed,
	isMultiBlock,
	selectionToRange,
} from "./selection/helpers";
export { snapToNormalPosition } from "./selection/normalPosition";
export type { NormalPositionSnapshot } from "./selection/normalPosition";
export { buildNormalPositionSnapshot } from "./commands/helpers";
export { ExtensionManagerImpl } from "./editor/extensionManager";
// ApplyPipeline stays off the barrel; hosts call editor.apply.
export {
	APPLY_STORM_CODE,
	APPLY_STORM_QUEUE_LIMIT,
	PIPELINE_PHASES,
} from "./editor/pipelinePhases";
// @input/pen-types already publishes PipelinePhase; PIPELINE_PHASES is the runtime tuple.
export {
	hasIndexedCellSelectionMetadata,
	resolveCellSelectionCoord,
	resolveCellSelectionMatrix,
} from "./editor/cellSelection";
export { getNumberedListItemValue } from "./editor/orderedList";
export {
	createImportResult,
	filterOpsForDocumentProfile,
	filterPendingBlocksForDocumentProfile,
	getBlockContentRole,
	getBlockSelectionRoleFromSchema,
	getBlockSelectionRoleFromType,
	getFlowCapabilityFromSchema,
	getFlowCapabilityFromType,
	isContinuousTextFlowCapability,
	normalizePendingBlocksForImport,
	reportPendingBlockImportViolations,
	reportPendingBlockProfileViolations,
	resolveBlockFlowCapability,
	shouldAllowDirectBlockPaste,
	shouldAllowFlowInsertionInSlashMenu,
	shouldExposeBlockInTooling,
	shouldShowBlockInDefaultMenus,
	shouldForceBlockScopedSelectAll,
};
export {
	renderSelectionTargetBlockText,
	renderSelectionTargetText,
	resolveSelectionTargetBlockIds,
} from "./editor/operationSelectionTargets";
// @input/pen-types already publishes ModelOperationRangeTarget.
export type {
	PendingBlockImportPolicyViolation,
	PendingBlockProfilePolicyViolation,
	ProfilePolicyViolation,
} from "./editor/profilePolicy";

// Importer utilities (used by the interop importers)
export { blocksToOps } from "./importerUtils";
export type {
	PendingBlock,
	ImportOptions as ImporterOptions,
} from "./importerUtils";

// Exporter utilities (shared by the interop exporters)
export { buildTableChildren } from "./exporterUtils";

// Document migrations (DUR4)
export { runMigrations } from "./migrations/runMigrations";
export type { DocumentMigration, MigrationReport } from "./migrations/types";

export {
	foldAndNormalize,
	nextGraphemeBoundary,
	nextWordBoundary,
	previousGraphemeBoundary,
	previousWordBoundary,
	wordRangeAt,
} from "./editor/textSegmentation";
export type { WordRange } from "./editor/textSegmentation";

export { defineFacet, createFacetRegistry } from "./facets/registry";
export type {
	FacetRegistry,
	CreateFacetRegistryOptions,
	FacetSettleInput,
} from "./facets/registry";
export {
	keymapFacet,
	beforeApplyFacet,
	decorationsFacet,
	inputRulesFacet,
	commandsFacet,
	ariaReadOnlyFacet,
	clipboardFacet,
} from "./facets/coreFacets";
export { urlPolicyFacet } from "./facets/urlPolicyFacet";
export {
	aiEgressExtension,
	aiEgressFacet,
	filterAIRequest,
	streamThroughEgress,
} from "./facets/aiEgressFacet";
export {
	blockDirectionFacet,
	defaultDirectionFacet,
} from "./facets/directionFacets";
export type { BlockDirectionResolver } from "./facets/directionFacets";
export type {
	BlockDirection,
	BlockDirectionSetting,
} from "./direction/firstStrong";
export { resolveBlockDirection } from "./direction/resolve";
export {
	urlPolicy,
	type UrlContext,
	type UrlPolicy,
} from "./security/urlPolicy";
export { blockLogicalText } from "./text/blockLogicalText";
export {
	inlineLogicalText,
	resolveSuggestionMenuTarget,
	type SuggestionMenuBoundary,
	type SuggestionMenuTarget,
	type SuggestionMenuTrigger,
} from "./suggestion/resolveSuggestionMenuTarget";
export {
	applyDirectedBinding,
	resolveDirectedBinding,
	resolveDirectedCommand,
	resolveFocusBlockDirection,
} from "./commands/resolveDirectedBinding";
export {
	applyMergeBlocks,
	applySplitBlock,
	buildMergeBlocksRecipe,
	buildSplitBlockRecipe,
	spliceDeleteOp,
	spliceInsertOp,
} from "./ops/recipes";
export { defineCommand, commandHandler } from "./commands/define";
export { createCommandRegistry } from "./commands/registry";
export { getCommandRegistry } from "./commands/install";
export { builtinCommandHandlers } from "./commands/builtin";
export type {
	CommandDispatchContext,
	CommandRegistry,
	CreateCommandRegistryOptions,
} from "./commands/registry";
export {
	caretBlockEnd,
	caretBlockStart,
	caretDocEnd,
	caretDocStart,
	caretDown,
	caretLeft,
	caretLineEnd,
	caretLineStart,
	caretRight,
	caretUp,
	caretWordLeft,
	caretWordRight,
	getCellCaretFocus,
	selectAll,
	selectBlock,
	setCellCaretFocus,
} from "./commands/caret";
export type {
	CaretMotionParam,
	CellCaretFocus,
	CellCaretWrite,
	SelectBlockParam,
} from "./commands/caret";
export {
	getVerticalCaretGoalX,
	getVerticalCaretMeasure,
	setVerticalCaretGoalX,
	setVerticalCaretMeasure,
} from "./commands/verticalCaret";
export type {
	VerticalCaretDirection,
	VerticalCaretMeasure,
	VerticalCaretMeasureResult,
	VerticalCaretPoint,
} from "./commands/verticalCaret";
export {
	convertBlock,
	deleteAdjacentInlineAtom,
	deleteBackward,
	deleteForward,
	indent,
	insertLineBreak,
	insertText,
	outdent,
	selectAdjacentInlineAtom,
	splitBlock,
	toggleMark,
} from "./commands/text";
export {
	convertBlockOps,
	isContainerBlockType,
	shouldRenderContainerChildren,
} from "./commands/commandBlockContext";
export { isContainerBlock } from "./schema/contentType";
export type {
	ConvertBlockParam,
	DeleteGranularity,
	DeleteParam,
	InsertTextParam,
	ToggleMarkParam,
} from "./commands/text";
export {
	deleteBlock,
	duplicateBlock,
	moveBlockDown,
	moveBlockUp,
} from "./commands/structure";
export type { StructureBlockParam } from "./commands/structure";
export {
	tableCellDown,
	tableCellNext,
	tableCellPrev,
	tableEscapeGrid,
} from "./commands/table";
export { historyRedo, historyUndo } from "./commands/history";
export {
	defaultKeymapBindings,
	resolveDefaultKeymap,
} from "./commands/defaultKeymap";
export type {
	DefaultKeymapBinding,
	DefaultKeymapContext,
	KeymapPlatform,
} from "./commands/defaultKeymap";
export { localeFacet, messagesFacet } from "./facets/i18nFacets";
export { a11yLabelFacet } from "./facets/a11yFacets";
export { interpolateMessage, resolveMessage } from "./i18n/messages";
export {
	createMutationGroupMetadata,
	getApplyOptionsGroupId,
	getOpOriginGroupId,
	getOpOriginType,
} from "./editor/origin";
export { collectToolExecutionOutput } from "./editor/toolExecution";
export {
	delegatesToGridEditing,
	hasFieldEditorSurface,
	resolveFieldEditorBehavior,
	resolveFieldEditorInputMode,
	supportsInlineInputRules,
	supportsInlineMarks,
	usesInlineTextSelection,
} from "./schema/fieldEditorCapabilities";
export { resolveEditorMessage } from "./i18n/resolveEditorMessage";
export {
	A11Y_MISSING_LABEL_CODE,
	resolveEditorA11yLabel,
} from "./a11y/resolveEditorA11yLabel";
export {
	announceEditorA11y,
	resolveA11yBlockTypeLabel,
} from "./a11y/announceEditorA11y";
export { resolveA11ySpec, resolveSchemaA11y } from "./a11y/resolveSchemaA11y";
export type { SchemaA11yAttrs, SchemaA11yKind } from "./a11y/resolveSchemaA11y";
export type { EditorA11yLabelAttrs } from "./a11y/resolveEditorA11yLabel";
export {
	createPseudoLocaleCatalog,
	isPseudoLocaleText,
	PSEUDO_LOCALE_CLOSE,
	PSEUDO_LOCALE_OPEN,
	toPseudoLocaleText,
} from "./i18n/pseudoLocale";
export type {
	Keymap,
	BeforeApplyHook,
	DecorationSource,
	ClipboardHandler,
	CommandHandlerTable,
} from "./facets/coreFacets";
export {
	HOOK_PRIORITIES,
	priorityToPrecedence,
	hookPriorityToPrecedence,
	keyBindingPriorityToPrecedence,
} from "./facets/precedence";
export {
	singleController,
	fieldEditorHostFacet,
	inputRulesEngineFacet,
	undoRestoreControllerFacet,
	undoMetadataControllerFacet,
	undoManagerFacet,
	aiInlineCompletionFacet,
	aiControllerFacet,
	aiInlineHistoryFacet,
	aiReviewControllerFacet,
	aiAutocompleteControllerFacet,
	aiSuggestionsControllerFacet,
	searchControllerFacet,
	multiplayerControllerFacet,
	snapshotsControllerFacet,
	assetProviderFacet,
	toolRuntimeFacet,
	announcerFacet,
	streamingTargetFacet,
	smoothStreamControllerFacet,
} from "./facets/controllerFacets";
export { collectEditorKeyBindings } from "./editor/extensionManager";
export { affectedBlockIdsFromSummary } from "./changes/affectedBlocks";
export { mapOffsetThroughSplices } from "./changes/mapOffsetThroughSplices";
