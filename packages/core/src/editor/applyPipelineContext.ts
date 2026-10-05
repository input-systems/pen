import type {
	CRDTAdapter,
	CRDTDocument,
	CRDTEvent,
	CRDTMap,
	DiagnosticEvent,
	DocumentOp,
	OpOrigin,
	PenDocument,
	SchemaRegistry,
	StructuralOriginTag,
} from "@input/pen-types";
import type { SchemaEngineImpl } from "../schema/normalize";
import type { CRDTUnknownArray, CRDTUnknownMap } from "./crdtShapes";
import type { EventEmitter } from "./events";
import type { PipelinePhase } from "./pipelinePhases";
import type { SelectionAuthorityImpl } from "./selection";
import type { TableGridExecutor } from "./tableGridExecutor";

/**
 * Wraps one apply's execution, e.g. in its undo capture key (AIB4). It runs
 * when the ops execute, so an apply queued behind the running one still
 * executes under its own wrapper rather than whatever was ambient when it
 * was issued.
 */
export type ApplyCapture = (run: () => void) => void;

export type ApplyPipelineMutableMap = CRDTUnknownMap & {
	delete(key: string): void;
};
export type ApplyPipelineMutableBlockStore = ApplyPipelineMutableMap & {
	get(key: string): CRDTUnknownMap | undefined;
};
export type ApplyPipelineMutableAppStore = ApplyPipelineMutableMap & {
	get(key: string): CRDTUnknownMap | undefined;
};
export type ApplyPipelineMutableStringArray = CRDTUnknownArray<string>;
export type ApplyPipelineCRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

/** CRDT document roots and adapter — shared by all apply modules. */
export interface ApplyPipelineDocumentContext {
	readonly blocks: ApplyPipelineCRDTBlockMap;
	readonly apps: CRDTMap<CRDTMap<unknown>>;
	readonly mutableBlocks: ApplyPipelineMutableBlockStore;
	readonly mutableBlockOrder: ApplyPipelineMutableStringArray;
	readonly mutableApps: ApplyPipelineMutableAppStore;
	readonly _adapter: CRDTAdapter;
	readonly _registry: SchemaRegistry;
	readonly _crdtDoc: CRDTDocument;
	readonly _tableGrid: TableGridExecutor;
	readonly _emitter: EventEmitter;
	/**
	 * The normalizer, whose pass index the block executors resolve positions
	 * through and advance at every structural write (SCALE2).
	 */
	readonly _engine: SchemaEngineImpl;
	_doc: PenDocument;
}

/** Orchestration state: queue, hooks, validation dispatch, transaction shell. */
export interface ApplyPipelineOrchestrationContext extends ApplyPipelineDocumentContext {
	_applying: boolean;
	_applyTurnCount: number;
	_applyStormEmitted: boolean;
	_suppressObserver: boolean;
	_unknownBlockTypesReported: Set<string> | undefined;
	/** Whether the next apply sweeps every block for unknown types: after a load. */
	_unknownScanPending: boolean;
	/** Blocks a remote or undo commit stored or retyped since the last apply. */
	readonly _unknownTypeCandidates: Set<string>;
	_commitDiagnostics: DiagnosticEvent[];
	readonly _queue: {
		ops: DocumentOp[];
		origin: OpOrigin;
		structural?: StructuralOriginTag;
		capture?: ApplyCapture;
	}[];
	readonly _selection: SelectionAuthorityImpl;
	_onDidApply: ((event: CRDTEvent) => void) | null;
	_recordPhase: ((phase: PipelinePhase) => void) | null;
	_captureSelectionBefore: (() => void) | null;
	_resolveBeforeApplyHooks:
		| (() => ReadonlyArray<
				(
					ops: DocumentOp[],
					options: { origin?: OpOrigin },
				) => DocumentOp[]
		  >)
		| null;
	readonly _beforeApplyHooks: Array<{
		hook: (
			ops: DocumentOp[],
			options: { origin?: OpOrigin },
		) => DocumentOp[];
		priority: number;
	}>;
	_finalBeforeApplyHook:
		| ((ops: DocumentOp[], options: { origin?: OpOrigin }) => DocumentOp[])
		| null;
	readonly _applyBoundaryHooks: Array<
		(event: {
			phase: "before" | "after";
			ops: readonly DocumentOp[];
			origin: OpOrigin;
			applied: boolean;
		}) => void
	>;
}

export type ApplyPipelineInternal = ApplyPipelineOrchestrationContext;

export type ApplyPipelineDocumentAccess = ApplyPipelineDocumentContext;
