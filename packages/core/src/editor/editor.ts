import type {
	Editor,
	EditorInternals,
	CreateEditorOptions,
	PenEventMap,
	CRDTAdapter,
	CRDTDocument,
	CRDTEvent,
	PenDocument,
	SchemaRegistry,
	Awareness,
	DocumentSession,
	DocumentScope,
	DocumentScopeReplacementEvent,
	DocumentProfile,
	Extension,
	DocumentOp,
	ApplyOptions,
	OpOrigin,
	MutationGroupMetadata,
	SelectionState,
	TextSelection,
	DocumentRange,
	BlockHandle,
	Block,
	DocumentState,
	UndoManager,
	Unsubscribe,
	CRDTMap,
	CRDTArray,
	Position,
	DecorationSet,
	EditorViewMode,
	ChangeSummary,
	Facet,
	FacetOutput,
	PipelinePhase,
	SelectionRecord,
	SelectionOrigin,
	OpenTextStreamOptions,
	TextStreamWriter,
	EditorAnchors,
	SelectAllBehavior,
} from "@input/pen-types";
import {
	MUTATION_GROUP_METADATA_KEY,
	UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY,
	generateId,
} from "@input/pen-types";
import { yjsAdapter } from "@input/pen-yjs";
import { resolveEditorSchema } from "../schema/emptySchema";
import { SchemaEngineImpl } from "../schema/normalize";
import { createBlockHandle } from "../schema/handles";
import { EventEmitter } from "./events";
import { ApplyPipeline } from "./apply";
import { resolveCellSelectionMatrix } from "./cellSelection";
import { filterOpsForDocumentProfile } from "./profilePolicy";
import type { CRDTUnknownMap } from "./crdtShapes";
import {
	getTextProp,
	getTableContent,
	getCellText as getCellTextFromRow,
	isCRDTMap,
} from "./crdtShapes";
import { ExtensionManagerImpl } from "./extensionManager";
import { EditorAnchorsImpl } from "./anchors";
import { SelectionAuthorityImpl } from "./selection";
import { DocumentStateImpl } from "./documentState";
import { emptyDecorationSet, reconcileDecorationSets } from "./decorations";
import { DocumentRangeImpl } from "./range";
import { createDocumentSession } from "./documentSession";

import { installEditorCommandRegistry } from "../commands/install";
import { beforeApplyFacet } from "../facets/coreFacets";
import { a11yLabelFacet } from "../facets/a11yFacets";
import {
	localeFacet,
	messagesFacet,
	resolveEnvironmentLocale,
} from "../facets/i18nFacets";
import { createFacetRegistry, type FacetRegistry } from "../facets/registry";
import {
	getRawBlockMap,
	getEditorInternals,
	applyEditorOps,
	recordMutationGroupMetadata,
	loadEditorDocument,
	iterateBlocks,
	getEditorBlock,
	getFirstBlock,
	getLastBlock,
	getBlockCount,
	getEditorBlockRevision,
	destroyEditor,
} from "./editorApiHelpers";
import { createEmptyBlockIndex } from "../changes/blockIndex";
import { snapshotSelectionRecord } from "./commitEvent";
import { openEditorTextStream } from "./openTextStream";
import {
	createPenDocumentForEditor,
	resolveEditorExtensions,
	installProfilePolicyHook,
	enforceDocumentProfileBoundary,
	refreshCoreSlots,
	bindEditorSession,
	bindEditorScope,
	handleEditorScopeReplacement,
	resolveEditorDocumentProfile,
	persistEditorDocumentProfile,
	rebindActiveScope,
	refreshUndoManager,
	activateEditorExtensions,
	queueExtensionLifecycle,
	ensureInitialParagraph,
	createCommitEvent,
	dispatchCRDTEvent,
	syncDocumentProfileFromStorage,
	wireEditorObservation,
	teardownEditorObservation,
} from "./editorLifecycle";
import {
	replaceEditorSelection,
	deleteEditorSelection,
	getTextForBlock,
	usesInlineTextSelectionForBlock,
	getBlockSelectionSpan,
	isWholeBlockSelection,
	sliceInlineDeltas,
	buildMultiBlockTextReplacement,
	deleteMultiBlockTextRange,
	replaceMultiBlockTextRange,
} from "./editorSelectionMutations";
import type {
	DocumentCommitEvent,
	EditorImplInternal,
	EditorSelectionMutationContext,
} from "./editorImplContext";
import { runPendingEmptyBlockMigrations } from "../migrations/runPendingEmptyBlockMigrations";
import { createTextSelection, selectionToRange } from "../selection/helpers";
import {
	buildTransitionSnapshot,
	fromTransitionSelection,
	toTransitionSelection,
} from "../commands/helpers";
import { escalateSelectAll } from "../selection/transitions";
type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

// Stub undo manager for when @input/pen-undo is excluded
const NOOP_UNDO: UndoManager = {
	undo: () => false,
	redo: () => false,
	canUndo: () => false,
	canRedo: () => false,
	stopCapturing: () => {},
	syncExplicitUndoGroup: () => {},
	setGroupTimeout: () => {},
	registerTrackedOrigins: () => () => {},
	onStackChange: () => () => {},
};

class EditorImpl implements Editor {
	private readonly _adapter: CRDTAdapter;
	private readonly _registry: SchemaRegistry;
	private _engine: SchemaEngineImpl;
	private readonly _extensions: ExtensionManagerImpl;
	private _selection: SelectionAuthorityImpl;
	private _anchors: EditorAnchorsImpl;
	private readonly _emitter: EventEmitter;
	private _pipeline: ApplyPipeline;
	private _documentState: DocumentStateImpl;
	private _doc!: PenDocument;
	private _crdtDoc!: CRDTDocument;
	private _documentSession: DocumentSession | null = null;
	private _documentScope!: DocumentScope;
	private _releaseSession: Unsubscribe | null = null;
	private _unsubObserve: Unsubscribe | null = null;
	private _awareness: Awareness | null = null;
	private readonly _slots = new Map<string, unknown>();
	private _clientId: number;
	private _documentProfile: DocumentProfile;
	private readonly _explicitEditorViewMode: EditorViewMode | null;
	private _editorViewMode: EditorViewMode;
	private _commitId = 0;
	private _pendingSummary: ChangeSummary | null = null;
	private _deferredCRDTEvent: CRDTEvent | null = null;
	private _lastChangeSummary: ChangeSummary | null = null;
	private _blockIndex = createEmptyBlockIndex();
	private _unsubSummary: Unsubscribe | null = null;
	private readonly _blockRevisions = new Map<string, number>();
	private _decorations: DecorationSet;
	private readonly _viewId = generateId();
	private _extensionLifecycle: Promise<void> = Promise.resolve();
	private _facetRegistry!: FacetRegistry;
	private _slotDeprecationWarned = new Set<string>();
	private _isDestroyed = false;
	private readonly _pipelinePhaseListeners: Array<
		(phase: PipelinePhase) => void
	> = [];
	private readonly _eventDeprecationWarned = new Set<string>();
	private _selectionBeforeRecord: SelectionRecord | null = null;

	private get _impl(): EditorImplInternal {
		return this as unknown as EditorImplInternal;
	}

	private get _selectionCtx(): EditorSelectionMutationContext {
		return this as unknown as EditorSelectionMutationContext;
	}

	readonly undoManager: UndoManager;

	constructor(options: CreateEditorOptions = {}) {
		this._registry = resolveEditorSchema(options);
		this._explicitEditorViewMode = options.editorViewMode ?? null;
		this._adapter =
			options.documentSession?.adapter ?? options.crdt ?? yjsAdapter();
		const documentSession =
			options.documentSession ??
			createDocumentSession({
				adapter: this._adapter,
				document: options.document,
				destroyWhenIdle: true,
				ownsDocuments: options.document == null,
			});
		this._bindSession(documentSession, options.documentScopeId);
		this._documentProfile = this._resolveDocumentProfile(
			options.documentProfile,
		);
		this._editorViewMode =
			this._explicitEditorViewMode ?? this._documentProfile;
		this._clientId = this._adapter.getClientId(this._crdtDoc);

		this._emitter = new EventEmitter();
		this._engine = new SchemaEngineImpl(
			this._registry,
			this._doc,
			this._crdtDoc,
		);
		this._anchors = new EditorAnchorsImpl(this._crdtDoc, {
			adapter: this._adapter,
			emit: (event) => {
				this._emitter.emit("diagnostic", event);
			},
			commitId: () => this._commitId,
		});
		this._selection = new SelectionAuthorityImpl(
			this._doc,
			this._crdtDoc,
			this._registry,
			this._emitter,
			this._anchors,
		);
		this._pipeline = new ApplyPipeline(
			this._doc,
			this._crdtDoc,
			this._adapter,
			this._registry,
			this._engine,
			this._emitter,
			this._selection,
		);
		this._documentState = new DocumentStateImpl(
			this._doc,
			this._crdtDoc,
			this._registry,
			this._documentProfile,
		);

		this._extensions = new ExtensionManagerImpl(this._emitter);
		const allExtensions = this._resolveExtensions(options);
		for (const ext of allExtensions) {
			this._extensions.register(ext);
		}
		const resolvedLocale = options.locale ?? resolveEnvironmentLocale();
		const i18nProviders = [
			localeFacet.of(
				resolvedLocale,
				options.locale != null ? "highest" : "lowest",
			),
		];
		if (options.messages) {
			i18nProviders.push(messagesFacet.of(options.messages, "highest"));
		}
		if (options.a11yLabel != null) {
			i18nProviders.push(a11yLabelFacet.of(options.a11yLabel, "highest"));
		}
		this._facetRegistry = createFacetRegistry({
			editor: this,
			extensions: allExtensions,
			providers: i18nProviders,
		});
		this._facetRegistry.markReady();
		installEditorCommandRegistry(this);

		this._installProfilePolicyHook();

		this.undoManager = NOOP_UNDO;
		this._decorations = emptyDecorationSet();
		this._refreshCoreSlots();

		// Constructing a document is not a change to one, so none of the three
		// writes below may produce a commit: a host cannot subscribe before the
		// constructor returns, and a commit nobody observes still consumes the
		// id its first apply should get (OB6). They land before the pipeline's
		// dispatch callback and the observer are wired, which is what keeps
		// them silent.
		//
		// Migrations run before the profile write: persisting refreshes the
		// format stamp, which would hide a stamp-2 document from the migration
		// check. The initial paragraph still goes through apply for validation
		// and normalization; the profile policy hook reaches it through the
		// pipeline's pre-init hook fallback.
		runPendingEmptyBlockMigrations(this);
		persistEditorDocumentProfile(this._impl);
		this._ensureInitialParagraph();
		// Silent writes skip the dispatch that normally refreshes these indexes.
		this._documentState.updateDocument(
			this._doc,
			this._crdtDoc,
			this._documentProfile,
		);

		this._pipeline._init(
			(event) => {
				this._dispatchCRDTEvent(event);
			},
			() => this._resolveBeforeApplyHooks(),
			(phase) => this._recordPipelinePhase(phase),
			() => this._captureSelectionBeforeForCommit(),
		);
		this._wireObservation();
		this._extensionLifecycle = this._activateExtensions();

		this._engine.normalizeAll();
		this._refreshDecorations();
		this._selection.bindEditor(this);
	}

	// ── Public API ───────────────────────────────────────────

	get clientId(): number {
		return this._clientId;
	}

	get documentScope(): DocumentScope {
		return this._documentScope;
	}

	get documentProfile(): DocumentProfile {
		return this._documentProfile;
	}

	get editorViewMode(): EditorViewMode {
		return this._editorViewMode;
	}

	get schema(): SchemaRegistry {
		return this._registry;
	}

	get selection(): SelectionState {
		return this._selection.getSelection();
	}

	get anchors(): EditorAnchors {
		return this._anchors;
	}

	get selectionRecord(): SelectionRecord {
		return this._selection.record;
	}

	get documentState(): DocumentState {
		return this._documentState;
	}

	private _getRawBlockMap(blockId: string): CRDTUnknownMap | null {
		return getRawBlockMap(this._impl, blockId);
	}

	get internals(): EditorInternals {
		return getEditorInternals(this._impl);
	}

	get lastChangeSummary(): ChangeSummary | null {
		return this._lastChangeSummary;
	}

	// ── Mutations ────────────────────────────────────────────

	apply(ops: DocumentOp[], options?: ApplyOptions): void {
		applyEditorOps(this._impl, ops, options);
	}

	openTextStream(
		target: { blockId: string },
		options: OpenTextStreamOptions,
	): TextStreamWriter {
		return openEditorTextStream(this, target, options, {
			runBeforeApplyHooks: (ops, origin) =>
				this._pipeline.runBeforeApplyHooks(ops, origin),
			deferBlock: (blockId) => {
				this._engine.deferBlock(blockId);
			},
			undeferBlock: (blockId) => {
				this._engine.undeferBlock(blockId);
			},
		});
	}

	private _recordMutationGroupMetadata(
		origin: OpOrigin,
		groupId: string | undefined,
	): void {
		recordMutationGroupMetadata(this._impl, origin, groupId);
	}

	loadDocument(doc: CRDTDocument): void {
		loadEditorDocument(this._impl, doc);
	}

	onBeforeApply(
		hook: (ops: DocumentOp[], options: ApplyOptions) => DocumentOp[],
		options?: { priority?: number },
	): Unsubscribe {
		return this._pipeline.addBeforeApplyHook(
			hook,
			options?.priority ?? 500,
		);
	}

	facet<F extends Facet<unknown, unknown>>(facet: F): FacetOutput<F> {
		return this._facetRegistry.read(facet);
	}

	whenReady(): Promise<void> {
		return this._extensionLifecycle;
	}

	// ── Block Traversal ──────────────────────────────────────

	*blocks(type?: string): Iterable<BlockHandle> {
		yield* iterateBlocks(this._impl, type);
	}

	getBlock(blockId: string): BlockHandle | null {
		return getEditorBlock(this._impl, blockId);
	}

	firstBlock(): BlockHandle | null {
		return getFirstBlock(this._impl);
	}

	lastBlock(): BlockHandle | null {
		return getLastBlock(this._impl);
	}

	blockCount(): number {
		return getBlockCount(this._impl);
	}

	getBlockRevision(blockId: string): number {
		return getEditorBlockRevision(this._impl, blockId);
	}

	// ── Selection ────────────────────────────────────────────

	setSelection(
		selection: SelectionState,
		options?: { origin?: SelectionOrigin },
	): void {
		this._writeSelection(selection, options?.origin ?? "programmatic");
	}

	getSelection(): SelectionState {
		return this._selection.getSelection();
	}

	selectBlock(blockId: string): void {
		this._writeSelection(
			{ type: "block", blockIds: [blockId], head: blockId },
			"programmatic",
		);
	}

	selectBlocks(blockIds: string[]): void {
		this._writeSelection(
			{
				type: "block",
				blockIds,
				head: blockIds[blockIds.length - 1] ?? blockIds[0] ?? "",
			},
			"programmatic",
		);
	}

	selectCell(blockId: string, row: number, col: number): void {
		this._writeSelection(
			{
				type: "cell",
				blockId,
				anchor: { row, col },
				head: { row, col },
			},
			"programmatic",
		);
	}

	selectCellRange(
		blockId: string,
		anchor: { row: number; col: number },
		head: { row: number; col: number },
	): void {
		this._writeSelection(
			{ type: "cell", blockId, anchor, head },
			"programmatic",
		);
	}

	selectText(blockId: string, from: number, to: number): void {
		this.selectTextRange(
			{ blockId, offset: from },
			{ blockId, offset: to },
		);
	}

	selectTextRange(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
	): void {
		this._writeSelection(
			createTextSelection({ anchor, focus }),
			"programmatic",
		);
	}

	selectAll(behavior?: SelectAllBehavior): void {
		const snapshot = buildTransitionSnapshot(this);
		const next = escalateSelectAll(
			snapshot,
			toTransitionSelection(this),
			behavior,
		);
		this._writeSelection(
			fromTransitionSelection(next, snapshot.blockOrder),
			"programmatic",
		);
	}

	getSelectedText(): string {
		return this._selection.getSelectedText();
	}

	getSelectedBlocks(): BlockHandle[] {
		return this._selection.getSelectedBlocks();
	}

	replaceSelection(content: string | Block[]): void {
		replaceEditorSelection(this._selectionCtx, content);
	}

	deleteSelection(options?: ApplyOptions): void {
		deleteEditorSelection(this._selectionCtx, options);
	}

	// ── Decorations ──────────────────────────────────────────

	requestDecorationUpdate(): void {
		const previousGeneration = this._decorations.generation;
		const decoSet = this._refreshDecorations();
		if (decoSet.generation === previousGeneration) return;
		this._emitter.emit("decorationsChange", decoSet.generation);
	}

	getDecorations(): DecorationSet {
		return this._decorations;
	}

	// ── Events ───────────────────────────────────────────────

	on<K extends keyof PenEventMap>(
		event: K,
		handler: PenEventMap[K],
	): Unsubscribe;
	on(event: string, handler: (...args: unknown[]) => void): Unsubscribe;
	on(event: string, handler: (...args: unknown[]) => void): Unsubscribe {
		return this._emitter.on(event, handler);
	}

	private _refreshDecorations(): DecorationSet {
		// providers rebuild every decoration on each pass; keep the previous
		// per-block lists where nothing changed so only touched blocks re-render
		this._decorations = reconcileDecorationSets(
			this._decorations,
			this._extensions.collectDecorations(this._documentState, this),
		);
		return this._decorations;
	}

	onSelectionChange(callback: PenEventMap["selectionChange"]): Unsubscribe {
		return this.on("selectionChange", callback);
	}

	onHistoryApplied(callback: PenEventMap["historyApplied"]): Unsubscribe {
		return this.on("historyApplied", callback);
	}

	// ── Extension State ──────────────────────────────────────

	getExtensionState<T>(name: string): T | undefined {
		return this._extensions.getExtensionState<T>(name);
	}

	// ── Normalization ────────────────────────────────────────

	normalizeAll(): void {
		this._engine.normalizeAll();
	}

	// ── Destroy ──────────────────────────────────────────────

	destroy(): Promise<void> {
		return destroyEditor(this._impl);
	}

	// ── Private ──────────────────────────────────────────────

	private _createPenDocument(crdtDoc: CRDTDocument): PenDocument {
		return createPenDocumentForEditor(this._impl, crdtDoc);
	}

	private _resolveExtensions(options: CreateEditorOptions): Extension[] {
		return resolveEditorExtensions(this._impl, options);
	}

	private _installProfilePolicyHook(): void {
		installProfilePolicyHook(this._impl);
	}

	private _enforceDocumentProfileBoundary(ops: DocumentOp[]): DocumentOp[] {
		return enforceDocumentProfileBoundary(this._impl, ops);
	}

	private _refreshCoreSlots(): void {
		refreshCoreSlots(this._impl);
	}

	private _bindSession(session: DocumentSession, scopeId?: string): void {
		bindEditorSession(this._impl, session, scopeId);
	}

	private _bindScope(session: DocumentSession, scopeId?: string): void {
		bindEditorScope(this._impl, session, scopeId);
	}

	private _handleScopeReplacement(
		session: DocumentSession,
		event: DocumentScopeReplacementEvent,
	): void {
		handleEditorScopeReplacement(this._impl, session, event);
	}

	private _resolveDocumentProfile(
		requestedProfile?: DocumentProfile,
	): DocumentProfile {
		return resolveEditorDocumentProfile(this._impl, requestedProfile);
	}

	private async _rebindActiveScope(): Promise<void> {
		await rebindActiveScope(this._impl);
	}

	private _refreshUndoManager(): void {
		refreshUndoManager(this._impl);
	}

	private async _activateExtensions(): Promise<void> {
		await activateEditorExtensions(this._impl);
	}

	private _queueExtensionLifecycle(task: () => Promise<void>): Promise<void> {
		return queueExtensionLifecycle(this._impl, task);
	}

	private _ensureInitialParagraph(): void {
		ensureInitialParagraph(this._impl);
	}

	private _createCommitEvent(event: CRDTEvent): DocumentCommitEvent {
		return createCommitEvent(this._impl, event);
	}

	private _dispatchCRDTEvent(event: CRDTEvent): void {
		dispatchCRDTEvent(this._impl, event);
	}

	private _recordPipelinePhase(phase: PipelinePhase): void {
		for (const listener of this._pipelinePhaseListeners) {
			listener(phase);
		}
	}

	private _onPipelinePhase(
		listener: (phase: PipelinePhase) => void,
	): Unsubscribe {
		this._pipelinePhaseListeners.push(listener);
		return () => {
			const index = this._pipelinePhaseListeners.indexOf(listener);
			if (index >= 0) {
				this._pipelinePhaseListeners.splice(index, 1);
			}
		};
	}

	private _captureSelectionBeforeForCommit(): void {
		this._selectionBeforeRecord = snapshotSelectionRecord(
			this._selection.record,
		);
	}

	private _writeSelection(
		selection: SelectionState,
		origin: SelectionOrigin,
	): void {
		const before = this._selection.record.version;
		this._selection.set(selection, { origin });
		const after = this._selection.record.version;
		if (after !== before) {
			this._facetRegistry.settle({
				selectionVersion: after,
			});
		}
	}

	private _syncDocumentProfileFromStorage(): void {
		syncDocumentProfileFromStorage(this._impl);
	}

	private _wireObservation(): void {
		wireEditorObservation(this._impl);
	}

	private _teardownObservation(): void {
		teardownEditorObservation(this._impl);
	}

	private _getTextForBlock(blockId: string): string {
		return getTextForBlock(this._selectionCtx, blockId);
	}

	private _getSelectionRange(sel: TextSelection): DocumentRange {
		return selectionToRange(this._doc, sel);
	}

	private _usesInlineTextSelection(blockId: string): boolean {
		return usesInlineTextSelectionForBlock(this._selectionCtx, blockId);
	}

	private _getBlockSelectionSpan(blockId: string): number {
		return getBlockSelectionSpan(this._selectionCtx, blockId);
	}

	private _isWholeBlockSelection(
		blockId: string,
		startOffset: number,
		endOffset: number,
	): boolean {
		return isWholeBlockSelection(
			this._selectionCtx,
			blockId,
			startOffset,
			endOffset,
		);
	}

	private _collapseToPoint(point: { blockId: string; offset: number }): void {
		this._writeSelection(
			createTextSelection({ anchor: point, focus: point }),
			"programmatic",
		);
	}

	private _sliceInlineDeltas(
		blockId: string,
		startOffset: number,
	): Array<{ insert: string; attributes?: Record<string, unknown> }> {
		return sliceInlineDeltas(this._selectionCtx, blockId, startOffset);
	}

	private _buildMultiBlockTextReplacement(
		range: DocumentRange,
		insertedText: string,
	): { ops: DocumentOp[]; caret: { blockId: string; offset: number } } {
		return buildMultiBlockTextReplacement(
			this._selectionCtx,
			range,
			insertedText,
		);
	}

	private _deleteMultiBlockTextRange(
		range: DocumentRange,
		options?: ApplyOptions,
	): { blockId: string; offset: number } | null {
		return deleteMultiBlockTextRange(this._selectionCtx, range, options);
	}

	private _replaceMultiBlockTextRange(
		range: DocumentRange,
		text: string,
	): { blockId: string; offset: number } {
		return replaceMultiBlockTextRange(this._selectionCtx, range, text);
	}

	private _resolveBeforeApplyHooks(): ReadonlyArray<
		(ops: DocumentOp[], options: { origin?: OpOrigin }) => DocumentOp[]
	> {
		const registered = this._pipeline
			.getBeforeApplyHooks()
			.map((entry) => entry.hook);
		const registeredSet = new Set(registered);
		const extras = this._facetRegistry
			.read(beforeApplyFacet)
			.filter((hook) => !registeredSet.has(hook));
		return [...extras, ...registered];
	}
}

export function createEditor(options?: CreateEditorOptions): Editor {
	return new EditorImpl(options);
}

const headlessPreset = {
	resolve() {
		return { extensions: [] };
	},
};

export interface CreateHeadlessEditorOptions extends CreateEditorOptions {
	/**
	 * Headless server/workflow editors default to the core apply pipeline only.
	 * Enable default extensions when a host explicitly needs undo, shortcuts, or
	 * delta stream behavior in a non-rendered environment.
	 */
	useDefaultExtensions?: boolean;
}

export function createHeadlessEditor(
	options: CreateHeadlessEditorOptions = {},
): Editor {
	const { useDefaultExtensions = false, ...editorOptions } = options;
	return createEditor({
		...editorOptions,
		preset:
			editorOptions.preset ??
			(useDefaultExtensions ? undefined : headlessPreset),
	});
}
