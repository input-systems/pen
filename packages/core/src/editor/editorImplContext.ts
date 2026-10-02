import type {
	ApplyOptions,
	Awareness,
	Block,
	BlockHandle,
	ChangeSummary,
	CRDTAdapter,
	CRDTDocument,
	CRDTEvent,
	CreateEditorOptions,
	DecorationSet,
	DocumentOp,
	DocumentProfile,
	DocumentRange,
	DocumentScope,
	DocumentScopeReplacementEvent,
	DocumentSession,
	EditorViewMode,
	Extension,
	Facet,
	FacetOutput,
	OpOrigin,
	PenDocument,
	PipelinePhase,
	SchemaRegistry,
	SelectionRecord,
	SelectionState,
	TextSelection,
	UndoManager,
	Unsubscribe,
} from "@input/pen-types";
import type { BlockIndex } from "../changes/blockIndex";
import type { SchemaEngineImpl } from "../schema/normalize";
import type { FacetRegistry } from "../facets/registry";
import type { ApplyPipeline } from "./apply";
import type { DecorationCollector, DecorationRefresh, DecorationTrigger } from "./decorationCollector";
import type { DocumentStateImpl } from "./documentState";
import type { EventEmitter } from "./events";
import type { ExtensionManagerImpl } from "./extensionManager";
import type { EditorAnchorsImpl } from "./anchors";
import type { SelectionAuthorityImpl } from "./selection";
import type { CRDTUnknownMap } from "./crdtShapes";

/** Intermediate commit object used to stamp revisions before `CommitEvent` is built. */
export interface DocumentCommitEvent {
	commitId: number;
	ops: readonly DocumentOp[];
	origin: OpOrigin;
	affectedBlocks: string[];
	blockRevisions: Readonly<Record<string, number>>;
	scope?: DocumentScope;
}

/** Block traversal, mutation apply, and destroy helpers. */
export interface EditorApiContext {
	readonly _adapter: CRDTAdapter;
	_crdtDoc: CRDTDocument;
	_doc: PenDocument;
	_engine: SchemaEngineImpl;
	_awareness: Awareness | null;
	_documentSession: DocumentSession | null;
	_documentScope: DocumentScope;
	readonly _viewId: string;
	readonly _emitter: EventEmitter;
	readonly _pipeline: ApplyPipeline;
	readonly _slots: Map<string, unknown>;
	readonly _facetRegistry: FacetRegistry;
	readonly _blockRevisions: Map<string, number>;
	_isDestroyed: boolean;
	_extensionLifecycle: Promise<void>;
	readonly _extensions: ExtensionManagerImpl;
	_decorations: DecorationSet;
	readonly _decorationCollector: DecorationCollector;
	_pendingSummary: ChangeSummary | null;
	_deferredCRDTEvent: CRDTEvent | null;
	_lastChangeSummary: ChangeSummary | null;
	_blockIndex: BlockIndex;
	readonly _documentState: DocumentStateImpl;
	_releaseSession: Unsubscribe | null;
	readonly _registry: SchemaRegistry;
	undoManager: UndoManager;
	_getRawBlockMap(blockId: string): CRDTUnknownMap | null;
	_onPipelinePhase(listener: (phase: PipelinePhase) => void): Unsubscribe;
	_recordMutationGroupMetadata(
		origin: OpOrigin,
		groupId: string | undefined,
	): void;
	_refreshUndoManager(): void;
	_queueExtensionLifecycle(task: () => Promise<void>): Promise<void>;
	_teardownObservation(): void;
	_bindSession(session: DocumentSession, scopeId?: string): void;
	_rebindActiveScope(): Promise<void>;
	apply(ops: DocumentOp[], options?: ApplyOptions): void;
	getBlock(blockId: string): BlockHandle | null;
	facet<F extends Facet<unknown, unknown>>(facet: F): FacetOutput<F>;
}

/** Document binding, scope lifecycle, commit dispatch, observation. */
export interface EditorLifecycleContext extends EditorApiContext {
	_anchors: EditorAnchorsImpl;
	_selection: SelectionAuthorityImpl;
	_documentProfile: DocumentProfile;
	readonly _explicitEditorViewMode: EditorViewMode | null;
	_editorViewMode: EditorViewMode;
	_clientId: number;
	_commitId: number;
	_selectionBeforeRecord: SelectionRecord | null;
	_unsubSummary: Unsubscribe | null;
	_unsubObserve: Unsubscribe | null;
	_createPenDocument(crdtDoc: CRDTDocument): PenDocument;
	_resolveExtensions(options: CreateEditorOptions): Extension[];
	_enforceDocumentProfileBoundary(ops: DocumentOp[]): DocumentOp[];
	_bindScope(session: DocumentSession, scopeId?: string): void;
	_handleScopeReplacement(
		session: DocumentSession,
		event: DocumentScopeReplacementEvent,
	): void;
	_resolveDocumentProfile(
		requestedProfile?: DocumentProfile,
	): DocumentProfile;
	_resolveBeforeApplyHooks(): ReadonlyArray<
		(ops: DocumentOp[], options: { origin?: OpOrigin }) => DocumentOp[]
	>;
	_dispatchCRDTEvent(event: CRDTEvent): void;
	_createCommitEvent(event: CRDTEvent): DocumentCommitEvent;
	_recordPipelinePhase(phase: PipelinePhase): void;
	_captureSelectionBeforeForCommit(): void;
	_refreshDecorations(trigger?: DecorationTrigger): DecorationRefresh;
	_activateExtensions(): Promise<void>;
	_syncDocumentProfileFromStorage(): void;
	_wireObservation(): void;
	_refreshCoreSlots(): void;
}

/** Selection replace/delete and multi-block text helpers. */
export interface EditorSelectionMutationContext extends EditorApiContext {
	_selection: SelectionAuthorityImpl;
	_getSelectionRange(sel: TextSelection): DocumentRange;
	_replaceMultiBlockTextRange(
		range: DocumentRange,
		text: string,
	): { blockId: string; offset: number };
	_deleteMultiBlockTextRange(
		range: DocumentRange,
		options?: ApplyOptions,
	): { blockId: string; offset: number } | null;
	_collapseToPoint(point: { blockId: string; offset: number }): void;
	_usesInlineTextSelection(blockId: string): boolean;
	_isWholeBlockSelection(
		blockId: string,
		startOffset: number,
		endOffset: number,
	): boolean;
	_getTextForBlock(blockId: string): string;
	_getBlockSelectionSpan(blockId: string): number;
	_sliceInlineDeltas(
		blockId: string,
		startOffset: number,
	): Array<{ insert: string; attributes?: Record<string, unknown> }>;
	_buildMultiBlockTextReplacement(
		range: DocumentRange,
		insertedText: string,
	): { ops: DocumentOp[]; caret: { blockId: string; offset: number } };
	setSelection(selection: SelectionState): void;
}

export type EditorImplInternal = EditorLifecycleContext;
