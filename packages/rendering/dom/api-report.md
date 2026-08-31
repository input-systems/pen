# @input/pen-dom

## .

`./dist/index.d.ts`

### class

- RegionSelectionStore

### function

- adoptEditorChrome
- attachContentGestures
- attachInlineAtomWrapperInteractions
- bindEditorDocumentKeyDown
- canDestructure
- collapsedRect
- createGeometryReader
- createReducedMotionSignal
- createRegionSelectionRect
- destructureInlineAtom
- getClosestEditorRoot
- getInlineAtomDragSnapshot
- getInlineAtomRenderInteractionProps
- getRootGeometry
- handleEditorDocumentKeyDown
- handleEscapeSelectionTransition
- handleFieldEditorPointerActivate
- handleTableCellSelectionKeyDown
- intersectRegionSelectionRect
- isFieldEditorTextEditingKey
- isInlineAtomDragSource
- measureWithRoot
- mountEditor
- registerInlineAtomInteractionRoot
- registerVerticalCaretMeasure
- resolveEditorUrl
- resolveRegionRect
- resolveShiftClickInlineAtomSelection
- selectInlineAtomRangeFromShiftClick
- shouldHandleEditorKeyboardEvent
- singleRunLineBox
- subscribeInlineAtomDragSnapshot
- urlPolicyExtension
- urlPolicyFromEditor
- verticalCaretTarget

### guard

- isActiveFieldEditorTextEntryTarget
- isFieldEditorTextEntryTarget
- isNativeTextEntryTarget
- isTextEntryTarget

### value

- DEFAULT_SELECT_ALL_BEHAVIOR
- DomScheduler
- DomSchedulerOptions
- DomSchedulerOwner
- DomSchedulerPhase
- EDITOR_CHROME_CUSTOM_PROPERTIES
- EditorSelectAllBehavior
- FieldEditorFocusReason
- FieldEditorFocusRequest
- FieldEditorImpl
- FieldEditorSession
- FlushCollect
- GeometryInvalidator
- getInlineAtomAtOffset
- PasteImporters
- PEN_EDITOR_CHROME_STYLESHEET
- PEN_REVIEW_STYLESHEET
- PenFieldEditorFocusOptions
- PenFocusAction
- PenFocusDecision
- PenFocusLifecycleEvent
- PenFocusLifecycleListener
- PenFocusPolicy
- PenFocusReason
- PenFocusRequest
- removeInlineAtom
- resolveSelectAllBehavior
- UrlContext
- urlPolicy
- UrlPolicy

### type

- Affinity
- AttachContentGesturesOptions
- BidiRun
- BidiRunGeometry
- BindEditorDocumentKeyDownOptions
- ContentGestureRegionGesture
- ContentGestureState
- FieldEditorPointerActivateOptions
- FieldEditorPointerTarget
- GeometryMeasureAdapter
- GeometryReader
- GeometryReaderHost
- GeometryReaderOptions
- GestureSlot
- InlineAtomDragSnapshot
- InlineAtomWrapperInteractionOptions
- LineBox
- MountedEditor
- MountEditorOptions
- Point
- Rect
- ReducedMotionListener
- ReducedMotionSignal
- RegionSelectionRect
- RegionSelectionSnapshot
- RegionSelectorActivation
- RegionSelectorConfig
- RegionSelectorSelectionMode
- RootGeometry
- VerticalCaretTarget
- VerticalDirection

## ./field-editor

`./dist/field-editor/index.d.ts`

### function

- classifySelectionSurface
- contractFieldEditorRange
- expandFieldEditorRange
- getExpandedBlockRole
- resolveMarksAtPosition
- shouldUseBlockSelection

### value

- applyDeltaToDOM
- buildMoveInlineAtomOps
- computeTextDiff
- domSelectionToEditor
- editorSelectionToDOM
- extractTextFromDOM
- FieldEditorFocusReason
- FieldEditorFocusRequest
- FieldEditorStore
- FieldEditorStoreSnapshot
- fullReconcileToDOM
- getCaretOffset
- getInlineAtomAtOffset
- getSelectionOffsets
- handleClipboardPaste
- handleCopy
- handleCut
- handlePaste
- INLINE_ATOM_LOGICAL_LENGTH
- InlineAtomDropTarget
- InlineAtomSnapshot
- InlineAtomSource
- moveInlineAtom
- MoveInlineAtomOptions
- PenFieldEditorFocusOptions
- PenFocusAction
- PenFocusDecision
- PenFocusLifecycleEvent
- PenFocusLifecycleListener
- PenFocusPolicy
- PenFocusReason
- PenFocusRequest
- removeInlineAtom
- RemoveInlineAtomOptions
- replaceInlineAtomWithText
- ReplaceInlineAtomWithTextOptions
- resolveInlineAtomDropTarget
- ResolveInlineAtomDropTargetOptions
- restoreSelection
- saveSelection
- SelectionPoint
- TextDiffOp

### type

- ExpandedBlockRole
- FieldEditorSurfaceMode
- FieldEditorSurfaceState

## ./field-editor/beforeinputMap

`./dist/field-editor/beforeinputMap.d.ts`

### function

- mapBeforeInput
- mapEditContextBeforeInput

### value

- BEFOREINPUT_MAP
- COMPOSITION_INPUT_TYPES

### type

- BeforeInputAllowPolicy
- BeforeInputBlockPolicy
- BeforeInputCommandMapping
- BeforeInputMapping

## ./field-editor/clipboard

`./dist/field-editor/clipboard.d.ts`

### function

- getPasteImporters
- handleClipboardPaste
- handleCopy
- handleCut
- handlePaste

## ./field-editor/commands

`./dist/field-editor/commands.d.ts`

### function

- applyBackspaceBehavior
- applyDeleteBehavior
- applyEnterBehavior
- applyListInputRule
- applyListTabBehavior
- convertBlock
- getConvertBlockOps
- insertTextAtRange
- mergeBackwardAtBlockStart
- moveCaretAcrossBlocks
- resolveBackspaceAction
- resolveEnterAction
- setInlineMark
- splitBlockAtOffset
- toggleInlineMark

### value

- getLogicalInlineLength
- InlineTextLike
- normalizeInlineOffset
- normalizeInlineRange
- SelectionRange
- SelectionTarget

## ./field-editor/contenteditableBackend

`./dist/field-editor/contenteditableBackend.d.ts`

### class

- ContentEditableBackend

## ./field-editor/crdt

`./dist/field-editor/crdt.d.ts`

_no exports_

## ./field-editor/dropResolver

`./dist/field-editor/dropResolver.d.ts`

### function

- getDropPreview
- resolveDropTarget

### type

- DropPreview
- ResolvedDropTarget
- ResolveDropTargetOptions

## ./field-editor/editContextBackend

`./dist/field-editor/editContextBackend.d.ts`

### class

- EditContextBackend

### type

- EditContextSelectionOptions

## ./field-editor/expandedContentEditableBackend

`./dist/field-editor/expandedContentEditableBackend.d.ts`

### class

- ExpandedContentEditableBackend

## ./field-editor/fieldEditorImpl

`./dist/field-editor/fieldEditorImpl.d.ts`

### value

- FieldEditorImpl

## ./field-editor/inlineAtomDom

`./dist/field-editor/inlineAtomDom.d.ts`

### function

- areInlineAtomElementDataEqual
- copyInlineAtomElementData
- createInlineAtomCaretBoundaryElement
- createInlineAtomElement
- domPointToLogicalOffset
- findLogicalDOMPoint
- getInlineAtomElementData
- getInlineAtomPointerOffset
- getLogicalNodeLength
- getLogicalTextContent

### guard

- isInlineAtomCaretBoundaryNode
- isInlineAtomChipNode
- isInlineAtomHostNode
- isInlineAtomNode

### value

- INLINE_ATOM_REPLACEMENT_TEXT
- resolveInlineAtomInsert

### type

- InlineAtomCaretBoundarySide
- InlineAtomElementData

## ./field-editor/inlineAtomInteraction

`./dist/field-editor/inlineAtomInteraction.d.ts`

### function

- buildMoveInlineAtomOps
- getInlineAtomAtOffset
- moveInlineAtom
- removeInlineAtom
- replaceInlineAtomWithText
- resolveInlineAtomDropTarget
- resolveInlineAtomInteractions

### value

- INLINE_ATOM_LOGICAL_LENGTH

### type

- InlineAtomAfterDestructureEvent
- InlineAtomAfterDestructureObserver
- InlineAtomDestructureHandler
- InlineAtomDropTarget
- InlineAtomInteractions
- InlineAtomMoveEvent
- InlineAtomMoveObserver
- InlineAtomMoveRejectedEvent
- InlineAtomMoveRejectedObserver
- InlineAtomRenderInteractionProps
- InlineAtomSnapshot
- InlineAtomSource
- MoveInlineAtomOptions
- RemoveInlineAtomOptions
- ReplaceInlineAtomWithTextOptions
- ResolvedInlineAtomInteractions
- ResolveInlineAtomDropTargetOptions

## ./field-editor/inlineAtomModel

`./dist/field-editor/inlineAtomModel.d.ts`

### function

- getInlineAtomAtOffset
- getInlineAtomInsertText
- getInlineAtomRangeAtOffset
- getInlineDeltaLength
- isInlineAtomRange
- resolveInlineAtomDisplayText
- resolveInlineAtomInsert

### value

- INLINE_ATOM_LOGICAL_LENGTH
- INLINE_ATOM_REPLACEMENT_TEXT

### type

- InlineAtomInsert
- InlineAtomRange
- InlineAtomSnapshot

## ./field-editor/keyHandling

`./dist/field-editor/keyHandling.d.ts`

### function

- handleEditorKeyBindings
- handleFieldEditorKeyDown
- handleHistoryShortcut
- handleSelectAllShortcut

## ./field-editor/reconciler

`./dist/field-editor/reconciler.d.ts`

### function

- applyDeltaToDOM
- fullReconcileDeltasToDOM
- fullReconcileToDOM
- restoreSelection
- saveSelection

### type

- SavedSelection

## ./field-editor/selectionBridge

`./dist/field-editor/selectionBridge.d.ts`

### function

- findBlockElement
- findInlineContentElement
- getClosestBlockElementFromPoint
- getSelectionPointForBlockAtPointer
- pointToEditorSelectionPoint
- queryBlockElement
- queryInlineElement

### value

- computeTextDiff
- DirectionalSelectionOffsets
- domPointToOffset
- domSelectionToEditor
- editorSelectionToDOM
- extractTextFromDOM
- getBlockBoundaryPoint
- getCaretOffset
- getDirectionalSelectionOffsets
- getSelectionOffsets
- getSelectionPointRect
- getTextSelectionClientRects
- SelectionBoundary
- SelectionPoint
- TextDiffOp

## ./field-editor/store

`./dist/field-editor/store.d.ts`

_no exports_

## ./field-editor/transfer

`./dist/field-editor/transfer.d.ts`

### function

- executeTransfer
- resolveTransferKind

### value

- ExecuteTransferOptions
- IMAGE_BLOCK_TYPE
- TransferKind
- TransferSource

## ./field-editor/transferImages

`./dist/field-editor/transferImages.d.ts`

### function

- canAcceptImageTransfer
- getAssetProvider
- getImageFiles
- insertUploadedImages
- insertUploadedImagesAtDropTarget
- resolveDefaultDropTarget
- uploadImageFiles

### type

- UploadImageFilesOptions

## ./constants/selectAll

`./dist/constants/selectAll.d.ts`

### function

- resolveSelectAllBehavior

### value

- DEFAULT_SELECT_ALL_BEHAVIOR

### type

- EditorSelectAllBehavior

## ./utils/autocompleteController

`./dist/utils/autocompleteController.d.ts`

### function

- getAutocompleteController

## ./utils/blockSelectionSemantics

`./dist/utils/blockSelectionSemantics.d.ts`

### function

- getBlockSelectionRoleFromSchema
- getBlockSelectionRoleFromType
- getEditorBlockSelectionLength
- getEditorBlockSelectionRole
- getSelectionLengthForRole
- isInlineEditableBlock

### value

- BlockSelectionRole

## ./utils/cellSelection

`./dist/utils/cellSelection.d.ts`

### function

- isCellInSelection

## ./utils/clipboardPayload

`./dist/utils/clipboardPayload.d.ts`

### class

- PenClipboardFallbackError

### function

- createPenClipboardPayload
- decodePenBlocksFromHtml
- encodePenBlocksForHtml
- parsePenClipboardPayload
- readPenClipboardJson
- serializePenClipboardPayload

### value

- PEN_CLIPBOARD_JSON_MIME
- PEN_CLIPBOARD_JSON_MIME_LEGACY
- PEN_CLIPBOARD_PAYLOAD_VERSION
- PenClipboardPayload

### type

- Delta
- PenBlock
- PenClipboardFallbackFlavor
- PenClipboardReadResult

## ./utils/flowCapabilities

`./dist/utils/flowCapabilities.d.ts`

### function

- getEditorFlowCapability
- getFlowCapabilityFromSchema
- getFlowCapabilityFromType
- isContinuousTextFlowCapability
- shouldAllowDirectBlockPaste
- shouldAllowFlowInsertionInSlashMenu
- shouldForceBlockScopedSelectAll
- shouldShowBlockInDefaultMenus

### value

- FlowBlockCapability

## ./utils/inlineInputRule

`./dist/utils/inlineInputRule.d.ts`

### function

- matchInlineInputRule

### type

- InlineInputRuleMatch

## ./utils/listInputRule

`./dist/utils/listInputRule.d.ts`

### function

- matchListInputRule

### type

- ListInputRuleMatch

## ./utils/selectionFormation

`./dist/utils/selectionFormation.d.ts`

### function

- normalizeSelectionFormation

## ./utils/dataAttributes

`./dist/utils/dataAttributes.d.ts`

### function

- buildDataAttributes
- penDataAttr

### value

- DATA_ATTRS
- OVERLAY_ITEM_ATTR
- OVERLAY_LAYER_ATTR

## ./utils/editorEmptyState

`./dist/utils/editorEmptyState.d.ts`

### function

- computeDocumentEmpty
- computeDocumentPlaceholderVisible
- isInlineContentEmpty

## ./utils/environment

`./dist/utils/environment.d.ts`

### function

- isDevelopmentEnvironment

## ./utils/placeholderVisibility

`./dist/utils/placeholderVisibility.d.ts`

### function

- resolveInlinePlaceholderVisibility

### type

- InlinePlaceholderVisibility
- InlinePlaceholderVisibilityOptions

## ./utils/inlineDecorations

`./dist/utils/inlineDecorations.d.ts`

### function

- applyInlineDecorationsToDeltas
- areInlineDecorationsRenderEqual
- areRenderedTextDeltasEqual
- buildInlineDecorationsRenderSignature
- filterVisibleInlineDecorationDeltas
- inlineDecorationsForBlock
- inlineDecorationsRequireFullReconcile
- retainRenderedTextDeltas

### value

- INLINE_DECORATION_ATTRIBUTE_KEY
- VIRTUAL_INLINE_DECORATION_ATTRIBUTE

### type

- TextDelta

## ./utils/parentIdTree

`./dist/utils/parentIdTree.d.ts`

### function

- appendParentIdChildBlock
- getAdjacentVisibleBlockId
- getChildBlockIds
- getInsertSiblingBlockOp
- getLastDescendantBlockId
- getRootBlockIds
- getVisibleBlockIds
- isInsideParentIdContainer

### value

- getParentIdChildBlockIds

## ./utils/fieldEditorTextEntryAttrs

`./dist/utils/fieldEditorTextEntryAttrs.d.ts`

### function

- fieldEditorTextEntryAttrs

## ./utils/menuPosition

`./dist/utils/menuPosition.d.ts`

### function

- resolveAnchoredMenuPosition

### type

- AnchoredMenuPosition
- MenuAnchorTarget
- MenuPlacementSide

## ./utils/selectionPlacement

`./dist/utils/selectionPlacement.d.ts`

### function

- resolveSelectionRect

## ./utils/tableDefaults

`./dist/utils/tableDefaults.d.ts`

### function

- createDefaultTableColumns
- getStarterTableProps
- getTableActivationTarget
- getTableCellPlaceholder
- hasMeaningfulBlockText

### type

- TableActivationTarget

## ./utils/aiDomScope

`./dist/utils/aiDomScope.d.ts`

### function

- queryAISuggestionAnchorElement
- queryEditorBlockElement
- querySuggestionAnchorElements
- resolveAIRootElement
- resolveEditorContentElement
- resolveEditorRootElement

## ./utils/aiKeyboardScope

`./dist/utils/aiKeyboardScope.d.ts`

### function

- shouldIgnoreAIKeyboardEvent

## ./utils/fieldEditor

`./dist/utils/fieldEditor.d.ts`

### function

- getAttachedFieldEditor
- getAttachedFieldEditorStore

## ./utils/inlineAtomDragPreview

`./dist/utils/inlineAtomDragPreview.d.ts`

### function

- clearInlineAtomDragPreview
- createInlineAtomDragPreview

### type

- InlineAtomDragPreview

## ./utils/replaceElementChildren

`./dist/utils/replaceElementChildren.d.ts`

### function

- replaceElementChildren

## ./utils/slashMenuPopupAria

`./dist/utils/slashMenuPopupAria.d.ts`

### function

- applySlashMenuFieldAria
- clearSlashMenuFieldAria
- getSlashMenuOptionId
- resolveSlashMenuField

## ./utils/suggestionMenuPopupAria

`./dist/utils/suggestionMenuPopupAria.d.ts`

### function

- applySuggestionMenuFieldAria
- clearSuggestionMenuFieldAria
- resolveSuggestionMenuField
- suggestionMenuOptionId

## ./utils/blockDrag

`./dist/utils/blockDrag.d.ts`

### function

- resolveDragBlockIds

## ./utils/editorInteractionModel

`./dist/utils/editorInteractionModel.d.ts`

### function

- isRepeatedCellSelection
- resolveBlockPointerIntent

### type

- BlockPointerIntent
- PointerCellCoord
- PointerInteractionModel

## ./utils/inlineAtomSelection

`./dist/utils/inlineAtomSelection.d.ts`

### function

- isInlineAtomSelected

## ./utils/pointerSelection

`./dist/utils/pointerSelection.d.ts`

### function

- createPointerSelectionGesture
- resolvePointerDragSelection
- resolvePointerGestureAnchorPoint

### type

- PointerSelectionGesture
- ResolvedPointerDragSelection

## ./utils/remoteCellSelection

`./dist/utils/remoteCellSelection.d.ts`

### function

- resolveRemoteCellPresence

### type

- RemoteCellCoord
- RemoteCellPresence
- RemoteCellPresenceMap
- RemoteCellSelectionLike
- RemoteCellUser
