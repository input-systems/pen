import type {
	DiagnosticEvent,
	DocumentOp,
	OpOrigin,
	CRDTEvent,
	CRDTDocument,
	CRDTAdapter,
	PenDocument,
	SchemaRegistry,
	CRDTMap,
	CRDTArray,
	StructuralOriginTag,
} from "@input/pen-types";
import type { SchemaEngineImpl } from "../schema/normalize";
import {
	type ApplyPipelineCRDTBlockMap,
	type ApplyPipelineInternal,
	type ApplyPipelineMutableAppStore,
	type ApplyPipelineMutableBlockStore,
	type ApplyPipelineMutableStringArray,
} from "./applyPipelineContext";
import type { EventEmitter } from "./events";
import type { SelectionAuthorityImpl } from "./selection";
import { TableGridExecutor } from "./tableGridExecutor";
import { applyInternal, transformOpsThroughHooks } from "./applyPipelineRunner";
import type { PipelinePhase } from "./pipelinePhases";

export class ApplyPipeline implements ApplyPipelineInternal {
	_doc: PenDocument;
	_crdtDoc: CRDTDocument;
	readonly _adapter: CRDTAdapter;
	readonly _registry: SchemaRegistry;
	readonly _tableGrid: TableGridExecutor;
	_engine: SchemaEngineImpl;
	readonly _emitter: EventEmitter;
	readonly _selection: SelectionAuthorityImpl;
	_onDidApply: ((event: CRDTEvent) => void) | null = null;
	_applying = false;
	_applyTurnCount = 0;
	_applyStormEmitted = false;
	_suppressObserver = false;
	_unknownBlockTypesReported: Set<string> | undefined;
	_unknownScanGeneration: number | undefined;
	readonly _queue: {
		ops: DocumentOp[];
		origin: OpOrigin;
		structural?: StructuralOriginTag;
	}[] = [];
	readonly _applyBoundaryHooks: Array<
		(event: {
			phase: "before" | "after";
			ops: readonly DocumentOp[];
			origin: OpOrigin;
			applied: boolean;
		}) => void
	> = [];
	readonly _beforeApplyHooks: Array<{
		hook: (
			ops: DocumentOp[],
			options: { origin?: OpOrigin },
		) => DocumentOp[];
		priority: number;
	}> = [];
	_finalBeforeApplyHook:
		| ((ops: DocumentOp[], options: { origin?: OpOrigin }) => DocumentOp[])
		| null = null;
	_resolveBeforeApplyHooks:
		| (() => ReadonlyArray<
				(
					ops: DocumentOp[],
					options: { origin?: OpOrigin },
				) => DocumentOp[]
		  >)
		| null = null;
	_recordPhase: ((phase: PipelinePhase) => void) | null = null;
	_captureSelectionBefore: (() => void) | null = null;
	_documentGeneration: (() => number) | null = null;
	_commitDiagnostics: DiagnosticEvent[] = [];

	get suppressObserver(): boolean {
		return this._suppressObserver;
	}

	get blocks(): ApplyPipelineCRDTBlockMap {
		return this._doc.blocks as ApplyPipelineCRDTBlockMap;
	}

	get mutableBlocks(): ApplyPipelineMutableBlockStore {
		return this._doc.blocks as unknown as ApplyPipelineMutableBlockStore;
	}

	get blockOrder(): CRDTArray<string> {
		return this._doc.blockOrder as CRDTArray<string>;
	}

	get mutableBlockOrder(): ApplyPipelineMutableStringArray {
		return this._doc
			.blockOrder as unknown as ApplyPipelineMutableStringArray;
	}

	get apps(): CRDTMap<CRDTMap<unknown>> {
		return this._doc.apps as CRDTMap<CRDTMap<unknown>>;
	}

	get mutableApps(): ApplyPipelineMutableAppStore {
		return this._doc.apps as unknown as ApplyPipelineMutableAppStore;
	}

	constructor(
		doc: PenDocument,
		crdtDoc: CRDTDocument,
		adapter: CRDTAdapter,
		registry: SchemaRegistry,
		engine: SchemaEngineImpl,
		emitter: EventEmitter,
		selection: SelectionAuthorityImpl,
	) {
		this._doc = doc;
		this._crdtDoc = crdtDoc;
		this._adapter = adapter;
		this._registry = registry;
		this._tableGrid = new TableGridExecutor(adapter);
		this._engine = engine;
		this._emitter = emitter;
		this._selection = selection;
	}

	/** Called after EditorImpl construction to wire circular refs. */
	_init(
		onDidApply?: (event: CRDTEvent) => void,
		resolveBeforeApplyHooks?: () => ReadonlyArray<
			(ops: DocumentOp[], options: { origin?: OpOrigin }) => DocumentOp[]
		>,
		recordPhase?: (phase: PipelinePhase) => void,
		captureSelectionBefore?: () => void,
		documentGeneration?: () => number,
	): void {
		this._onDidApply = onDidApply ?? null;
		this._resolveBeforeApplyHooks = resolveBeforeApplyHooks ?? null;
		this._recordPhase = recordPhase ?? null;
		this._captureSelectionBefore = captureSelectionBefore ?? null;
		this._documentGeneration = documentGeneration ?? null;
	}

	getBeforeApplyHooks(): ReadonlyArray<{
		hook: (
			ops: DocumentOp[],
			options: { origin?: OpOrigin },
		) => DocumentOp[];
		priority: number;
	}> {
		return this._beforeApplyHooks;
	}

	addBeforeApplyHook(
		hook: (
			ops: DocumentOp[],
			options: { origin?: OpOrigin },
		) => DocumentOp[],
		priority: number,
	): () => void {
		const entry = { hook, priority };
		this._beforeApplyHooks.push(entry);
		this._beforeApplyHooks.sort((a, b) => a.priority - b.priority);
		return () => {
			const idx = this._beforeApplyHooks.indexOf(entry);
			if (idx >= 0) this._beforeApplyHooks.splice(idx, 1);
		};
	}

	addApplyBoundaryHook(
		hook: (event: {
			phase: "before" | "after";
			ops: readonly DocumentOp[];
			origin: OpOrigin;
			applied: boolean;
		}) => void,
	): () => void {
		this._applyBoundaryHooks.push(hook);
		return () => {
			const idx = this._applyBoundaryHooks.indexOf(hook);
			if (idx >= 0) this._applyBoundaryHooks.splice(idx, 1);
		};
	}

	setFinalBeforeApplyHook(
		hook:
			| ((
					ops: DocumentOp[],
					options: { origin?: OpOrigin },
			  ) => DocumentOp[])
			| null,
	): void {
		this._finalBeforeApplyHook = hook;
	}

	takeCommitDiagnostics(): readonly DiagnosticEvent[] {
		const diagnostics = this._commitDiagnostics;
		this._commitDiagnostics = [];
		return diagnostics;
	}

	apply(
		ops: DocumentOp[],
		origin: OpOrigin,
		structural?: StructuralOriginTag,
	): void {
		applyInternal(this, ops, origin, structural);
	}

	runBeforeApplyHooks(ops: DocumentOp[], origin: OpOrigin): DocumentOp[] {
		return transformOpsThroughHooks(this, ops, origin);
	}

	updateDocument(
		doc: PenDocument,
		crdtDoc: CRDTDocument,
		engine: SchemaEngineImpl,
	): void {
		this._doc = doc;
		this._crdtDoc = crdtDoc;
		this._engine = engine;
		this._unknownScanGeneration = undefined;
	}
}
