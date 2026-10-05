import type {
	DocumentOp,
	OpOrigin,
	CRDTEvent,
	InsertBlockOp,
	SetPropsOp,
	StructuralOriginTag,
} from "@input/pen-types";
import type { DiagnosticEvent } from "@input/pen-types";
import { toStructuredOrigin } from "./commitEvent";
import { isCRDTMap } from "./crdtShapes";
import type { ApplyCapture, ApplyPipelineInternal } from "./applyPipelineContext";
import { validateOpProps } from "./validateOpProps";
import { blockExists, opBlockId } from "./applySharedHelpers";
import {
	insertBlock,
	deleteBlock,
	moveBlock,
	setProps,
	tagStructuralOrigin,
} from "./applyBlockOps";
import {
	spliceText,
	formatText,
	setMeta,
	tableOp,
	applyApp,
} from "./applyInlineAndMetaOps";
import {
	APPLY_STORM_CODE,
	APPLY_STORM_QUEUE_LIMIT,
	type PipelinePhase,
} from "./pipelinePhases";
import { resolveCommitSource } from "./commitEvent";
import { snapshotOrigin } from "./origin";
import { rejectedOwnPropKeys } from "./rejectedOwnKeys";
import { isJsonEncodable, isStorableMapValue } from "./encodablePayload";
export function applyInternal(
	pipeline: ApplyPipelineInternal,
	ops: DocumentOp[],
	origin: OpOrigin,
	structural?: StructuralOriginTag,
	capture?: ApplyCapture,
): void {
	if (pipeline._applying) {
		if (pipeline._applyTurnCount >= APPLY_STORM_QUEUE_LIMIT) {
			emitApplyStorm(pipeline);
			return;
		}
		pipeline._applyTurnCount += 1;
		pipeline._queue.push({ ops, origin, structural, capture });
		return;
	}

	pipeline._applying = true;
	pipeline._applyTurnCount = 1;
	pipeline._applyStormEmitted = false;
	try {
		executeCaptured(pipeline, ops, origin, structural, capture);
		while (pipeline._queue.length > 0) {
			const queued = pipeline._queue.shift()!;
			executeCaptured(
				pipeline,
				queued.ops,
				queued.origin,
				queued.structural,
				queued.capture,
			);
		}
	} finally {
		pipeline._applying = false;
		pipeline._applyTurnCount = 0;
		pipeline._applyStormEmitted = false;
	}
}

function executeCaptured(
	pipeline: ApplyPipelineInternal,
	ops: DocumentOp[],
	origin: OpOrigin,
	structural: StructuralOriginTag | undefined,
	capture: ApplyCapture | undefined,
): void {
	if (capture) {
		capture(() => executeOps(pipeline, ops, origin, structural));
	} else {
		executeOps(pipeline, ops, origin, structural);
	}
}

function emitPipelineDiagnostic(
	pipeline: ApplyPipelineInternal,
	diagnostic: DiagnosticEvent,
): void {
	if (!pipeline._commitDiagnostics) {
		pipeline._commitDiagnostics = [];
	}
	pipeline._commitDiagnostics.push(diagnostic);
	pipeline._emitter.emit("diagnostic", diagnostic);
}

function emitApplyStorm(pipeline: ApplyPipelineInternal): void {
	if (pipeline._applyStormEmitted) {
		return;
	}
	pipeline._applyStormEmitted = true;
	pipeline._emitter.emit("diagnostic", {
		code: APPLY_STORM_CODE,
		level: "warn",
		source: "apply",
		message:
			"apply-storm: more than 16 nested applies queued in one task turn",
		remediation:
			"Observers, decoration sources, and facet compute must not apply synchronously (I7).",
	});
}

function recordPhase(
	pipeline: ApplyPipelineInternal,
	phase: PipelinePhase,
): void {
	pipeline._recordPhase?.(phase);
}

/**
 * `registry.resolve` passes unknown types through (DUR3), so the declared set
 * is the only way to tell a registered type from an unknown one.
 */
function isRegisteredBlockType(
	registry: { allBlocks(): readonly { type: string }[] },
	type: string,
): boolean {
	for (const schema of registry.allBlocks()) {
		if (schema.type === type) {
			return true;
		}
	}
	return false;
}

function unknownBlockTypesReported(
	pipeline: ApplyPipelineInternal,
): Set<string> {
	if (!pipeline._unknownBlockTypesReported) {
		pipeline._unknownBlockTypesReported = new Set();
	}
	return pipeline._unknownBlockTypesReported;
}

function emitSchemaUnknownBlock(
	pipeline: ApplyPipelineInternal,
	type: string,
): void {
	const reported = unknownBlockTypesReported(pipeline);
	if (reported.has(type)) {
		return;
	}
	reported.add(type);
	emitPipelineDiagnostic(pipeline, {
		code: "schema-unknown-block",
		level: "info",
		source: "schema",
		message: `Unknown block type "${type}"`,
		blockType: type,
	});
}

/**
 * DUR3 wants one diagnostic per unknown type per session, including for blocks
 * no op touches, so the first apply after a load sweeps the whole document.
 * Apply refuses `insert-block` and `set-props` carrying an unregistered type
 * (PEN_APPLY_002), so no local apply can add a type a previous sweep did not
 * already see; only a load or a remote or undo commit can, and such a commit
 * names the blocks it stored or retyped. Later applies check only those, so a
 * keystroke or a structural commit sweeps nothing (SCALE2).
 */
function reportUnknownBlocksInDocument(pipeline: ApplyPipelineInternal): void {
	if (pipeline._unknownScanPending) {
		pipeline._unknownScanPending = false;
		pipeline._unknownTypeCandidates.clear();
		for (const [, rawBlockMap] of pipeline._doc.blocks.entries()) {
			reportUnknownBlockType(pipeline, rawBlockMap);
		}
		return;
	}
	if (pipeline._unknownTypeCandidates.size === 0) return;
	for (const blockId of pipeline._unknownTypeCandidates) {
		reportUnknownBlockType(pipeline, pipeline._doc.blocks.get(blockId));
	}
	pipeline._unknownTypeCandidates.clear();
}

function reportUnknownBlockType(
	pipeline: ApplyPipelineInternal,
	rawBlockMap: unknown,
): void {
	if (!isCRDTMap(rawBlockMap)) return;
	const type = rawBlockMap.get("type");
	if (typeof type !== "string") return;
	if (isRegisteredBlockType(pipeline._registry, type)) return;
	emitSchemaUnknownBlock(pipeline, type);
}

function readStoredBlockType(
	pipeline: ApplyPipelineInternal,
	blockId: string,
): string | null {
	const rawBlockMap = pipeline.blocks.get(blockId);
	if (!isCRDTMap(rawBlockMap)) {
		return null;
	}
	const type = rawBlockMap.get("type");
	return typeof type === "string" ? type : null;
}

function rewriteBlockOpProps(
	pipeline: ApplyPipelineInternal,
	op: InsertBlockOp | SetPropsOp,
	pendingBlockTypes: Map<string, string>,
): InsertBlockOp | SetPropsOp {
	const conversionType =
		op.type === "set-props" && typeof op.props.type === "string"
			? op.props.type
			: null;
	const blockType =
		op.type === "insert-block"
			? op.blockType
			: (conversionType ??
				pendingBlockTypes.get(op.blockId) ??
				readStoredBlockType(pipeline, op.blockId));
	if (!blockType) {
		return op;
	}
	const schema = pipeline._registry.resolve(blockType);
	if (!schema) {
		return op;
	}
	const propsForValidation: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(op.props)) {
		if (key === "type" || key === "layout" || key === "columns") {
			continue;
		}
		if (value === null) {
			continue;
		}
		propsForValidation[key] = value;
	}
	const result = validateOpProps(schema, propsForValidation);
	for (const diagnostic of result.diagnostics) {
		emitPipelineDiagnostic(pipeline, {
			...diagnostic,
			op,
		});
	}
	if (op.type === "insert-block") {
		if (result.props === op.props) {
			return op;
		}
		return { ...op, props: result.props };
	}
	const nextProps: Record<string, unknown | null> = { ...op.props };
	for (const [key, value] of Object.entries(result.props)) {
		nextProps[key] = value;
	}
	if (conversionType) {
		const allowed = new Set(Object.keys(schema.propSchema ?? {}));
		for (const key of Object.keys(nextProps)) {
			if (
				key === "type" ||
				key === "layout" ||
				key === "columns" ||
				nextProps[key] === null
			) {
				continue;
			}
			if (!allowed.has(key)) {
				delete nextProps[key];
				emitPipelineDiagnostic(pipeline, {
					code: "prop-invalid",
					level: "warn",
					source: "schema",
					message: `Dropped incompatible prop "${key}" for type "${conversionType}"`,
					op,
				});
			}
		}
	}
	return { ...op, props: nextProps };
}

export function transformOpsThroughHooks(
	pipeline: ApplyPipelineInternal,
	ops: DocumentOp[],
	origin: OpOrigin,
): DocumentOp[] {
	let transformedOps = ops;
	const beforeApplyHooks =
		pipeline._resolveBeforeApplyHooks?.() ??
		pipeline._beforeApplyHooks.map(
			(entry: {
				hook: (
					ops: DocumentOp[],
					options: { origin?: OpOrigin },
				) => DocumentOp[];
			}) => entry.hook,
		);
	for (const hook of beforeApplyHooks) {
		const next = runBeforeApplyHook(
			pipeline,
			hook,
			transformedOps,
			origin,
			{
				code: "PEN_APPLY_005",
				message: "onBeforeApply hook threw",
				nonArrayMessage: "onBeforeApply hook returned a non-array",
				remediation:
					"Update the onBeforeApply hook to handle incoming ops defensively and " +
					"always return a valid DocumentOp array.",
			},
		);
		if (next) {
			transformedOps = next;
		}
	}
	if (pipeline._finalBeforeApplyHook) {
		const next = runBeforeApplyHook(
			pipeline,
			pipeline._finalBeforeApplyHook,
			transformedOps,
			origin,
			{
				code: "PEN_APPLY_007",
				message: "final apply boundary hook threw",
				nonArrayMessage:
					"final apply boundary hook returned a non-array",
				remediation:
					"Update the final apply boundary hook to handle incoming ops defensively and " +
					"always return a valid DocumentOp array.",
			},
		);
		if (next) {
			transformedOps = next;
		}
	}
	return transformedOps;
}

function snapshotPlain(value: unknown): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(snapshotPlain);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return snapshotInstance(value);
	}
	const next: Record<string | symbol, unknown> = Object.create(prototype);
	for (const key of Object.keys(value as object)) {
		Object.defineProperty(next, key, {
			value: snapshotPlain((value as Record<string, unknown>)[key]),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	snapshotSymbolKeys(value, next);
	return next;
}

function snapshotSymbolKeys(value: object, next: object): void {
	for (const key of Object.getOwnPropertySymbols(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable) {
			continue;
		}
		Object.defineProperty(next, key, {
			value: snapshotPlain(descriptor.value),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
}

/**
 * A class instance is not plain data: copying its own keys would turn a
 * `Date` or `Map` into `{}`, which validate would then accept. It passes
 * through as is so validate sees what the caller sent (OPB1); only a
 * `Uint8Array`, which the CRDT stores, is copied.
 */
function snapshotInstance(value: object): unknown {
	return value instanceof Uint8Array ? value.slice() : value;
}

function snapshotOps(ops: readonly DocumentOp[]): DocumentOp[] {
	return ops.map((op) => snapshotPlain(op) as DocumentOp);
}

function runBeforeApplyHook(
	pipeline: ApplyPipelineInternal,
	hook: (ops: DocumentOp[], options: { origin?: OpOrigin }) => DocumentOp[],
	ops: DocumentOp[],
	origin: OpOrigin,
	labels: {
		code: string;
		message: string;
		nonArrayMessage: string;
		remediation: string;
	},
): DocumentOp[] | null {
	try {
		const next = hook(snapshotOps(ops), { origin: snapshotOrigin(origin) });
		if (!Array.isArray(next)) {
			emitPipelineDiagnostic(pipeline, {
				code: labels.code,
				level: "error",
				source: "apply",
				message: labels.nonArrayMessage,
				remediation: labels.remediation,
			});
			return null;
		}
		return next;
	} catch (err) {
		emitPipelineDiagnostic(pipeline, {
			code: labels.code,
			level: "error",
			source: "apply",
			message: labels.message,
			remediation: labels.remediation,
			error: err,
		});
		return null;
	}
}

const MALFORMED_OP_CODE = "PEN_APPLY_004";

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isNonNegativeInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInlineInsert(value: unknown): boolean {
	if (typeof value === "string") {
		return true;
	}
	if (!isRecord(value)) {
		return false;
	}
	return (
		isNonEmptyString(value.nodeType) &&
		isRecord(value.props) &&
		isJsonEncodable(value.props)
	);
}

function isPosition(value: unknown): boolean {
	if (value === "first" || value === "last") {
		return true;
	}
	if (!isRecord(value)) {
		return false;
	}
	if ("parent" in value) {
		return isNonEmptyString(value.parent) && isNonNegativeInt(value.index);
	}
	if ("before" in value) {
		return isNonEmptyString(value.before);
	}
	if ("after" in value) {
		return isNonEmptyString(value.after);
	}
	return false;
}

function hasStorableValues(record: Record<string, unknown>): boolean {
	return Object.values(record).every(isStorableMapValue);
}

/** Mark values are text attributes; `null` removes the mark. */
function hasEncodableMarks(marks: Record<string, unknown>): boolean {
	return Object.values(marks).every(isJsonEncodable);
}

function hasValidCell(cell: unknown): boolean {
	return (
		!cell ||
		(isRecord(cell) &&
			isNonNegativeInt(cell.row) &&
			isNonNegativeInt(cell.col))
	);
}

function malformedOpMessage(op: DocumentOp): string | null {
	const shape: unknown = op;
	if (!isRecord(shape) || typeof shape.type !== "string") {
		return "op must be an object with a string type";
	}
	switch (op.type) {
		case "splice-text": {
			if (!isNonEmptyString(op.blockId)) {
				return "splice-text requires a non-empty blockId";
			}
			if (!isNonNegativeInt(op.from)) {
				return "splice-text requires a non-negative integer from";
			}
			if (!isNonNegativeInt(op.to)) {
				return "splice-text requires a non-negative integer to";
			}
			if (op.from > op.to) {
				return "splice-text requires from <= to";
			}
			const items = Array.isArray(op.insert) ? op.insert : [op.insert];
			if (!items.every(isInlineInsert)) {
				return "splice-text requires string or atom insert with encodable props";
			}
			if (
				op.marks !== undefined &&
				(!isRecord(op.marks) || !hasEncodableMarks(op.marks))
			) {
				return "splice-text marks must be an object of JSON-encodable values";
			}
			if (!hasValidCell(op.cell)) {
				return "splice-text cell requires non-negative integer row and col";
			}
			return null;
		}
		case "format-text": {
			if (!isNonEmptyString(op.blockId)) {
				return "format-text requires a non-empty blockId";
			}
			if (!isNonNegativeInt(op.from)) {
				return "format-text requires a non-negative integer from";
			}
			if (!isNonNegativeInt(op.to)) {
				return "format-text requires a non-negative integer to";
			}
			if (op.from > op.to) {
				return "format-text requires from <= to";
			}
			if (!isRecord(op.marks)) {
				return "format-text requires a marks object";
			}
			if (!hasEncodableMarks(op.marks)) {
				return "format-text marks must be JSON-encodable values";
			}
			if (!hasValidCell(op.cell)) {
				return "format-text cell requires non-negative integer row and col";
			}
			return null;
		}
		case "insert-block":
			if (!isNonEmptyString(op.blockId)) {
				return "insert-block requires a non-empty blockId";
			}
			if (!isNonEmptyString(op.blockType)) {
				return "insert-block requires a non-empty blockType";
			}
			if (!isRecord(op.props) || !hasStorableValues(op.props)) {
				return "insert-block requires a props object of acyclic plain-data values";
			}
			if (!isPosition(op.position)) {
				return "insert-block requires a valid position";
			}
			return null;
		case "move-block":
			if (!isNonEmptyString(op.blockId)) {
				return "move-block requires a non-empty blockId";
			}
			if (!isPosition(op.position)) {
				return "move-block requires a valid position";
			}
			return null;
		case "set-props":
			if (!isNonEmptyString(op.blockId)) {
				return "set-props requires a non-empty blockId";
			}
			if (!isRecord(op.props) || !hasStorableValues(op.props)) {
				return "set-props requires a props object of acyclic plain-data values";
			}
			return null;
		case "set-meta":
			if (!isNonEmptyString(op.blockId)) {
				return "set-meta requires a non-empty blockId";
			}
			if (!isNonEmptyString(op.namespace)) {
				return "set-meta requires a non-empty string namespace";
			}
			if (
				op.data !== null &&
				(!isRecord(op.data) || !isStorableMapValue(op.data))
			) {
				return "set-meta requires a data object of acyclic plain-data values, or null";
			}
			return null;
		case "delete-block":
		case "stream-open":
			if (!isNonEmptyString(op.blockId)) {
				return `${op.type} requires a non-empty blockId`;
			}
			return null;
		case "grid": {
			if (!isNonEmptyString(op.blockId)) {
				return "grid requires a non-empty blockId";
			}
			if (!isRecord(op.change) || typeof op.change.kind !== "string") {
				return "grid requires a change object";
			}
			return null;
		}
		case "app": {
			if (!isRecord(op.change) || typeof op.change.kind !== "string") {
				return "app requires a change object";
			}
			if (op.change.kind === "create") {
				if (!isNonEmptyString(op.change.appId)) {
					return "app create requires a non-empty appId";
				}
				if (!isNonEmptyString(op.change.appType)) {
					return "app create requires a non-empty appType";
				}
				if (
					op.change.config !== undefined &&
					(!isRecord(op.change.config) ||
						!hasStorableValues(op.change.config))
				) {
					return "app create config must be an object of acyclic plain-data values";
				}
				if (!isStorableMapValue(op.change.placement)) {
					return "app create placement must be acyclic plain data";
				}
			} else if (
				op.change.kind === "update" ||
				op.change.kind === "delete"
			) {
				if (!isNonEmptyString(op.change.appId)) {
					return `app ${op.change.kind} requires a non-empty appId`;
				}
				if (
					op.change.kind === "update" &&
					(!isRecord(op.change.patch) ||
						!hasStorableValues(op.change.patch))
				) {
					return "app update requires a patch object of acyclic plain-data values";
				}
			}
			return null;
		}
		default: {
			const _exhaustive: never = op;
			return `unknown op type ${String((_exhaustive as { type?: unknown }).type)}`;
		}
	}
}

function emitMalformedOpDiagnostic(
	pipeline: ApplyPipelineInternal,
	op: DocumentOp,
	error?: unknown,
): void {
	emitPipelineDiagnostic(pipeline, {
		code: MALFORMED_OP_CODE,
		level: "warn",
		source: "apply",
		message:
			malformedOpMessage(op) ?? `apply: dropped malformed ${op.type}`,
		remediation:
			"Pass well-formed DocumentOp fields: string ids, non-negative integer offsets, and string text.",
		op,
		...(error !== undefined ? { error } : {}),
	});
}

function executeOps(
	pipeline: ApplyPipelineInternal,
	ops: DocumentOp[],
	origin: OpOrigin,
	structural?: StructuralOriginTag,
): void {
	pipeline._commitDiagnostics = [];
	reportUnknownBlocksInDocument(pipeline);
	pipeline._captureSelectionBefore?.();
	recordPhase(pipeline, "hooks");
	const transformedOps = transformOpsThroughHooks(pipeline, ops, origin);

	emitApplyBoundary(pipeline, {
		phase: "before",
		ops: transformedOps,
		origin,
		applied: false,
	});

	recordPhase(pipeline, "validate");
	const affectedBlocks: string[] = [];
	const validatedOps: DocumentOp[] = [];
	const batch: BatchLiveness = { inserted: new Set(), deleted: new Set() };
	const pendingBlockTypes = new Map<string, string>();

	for (const op of transformedOps) {
		// Shape first: every later check reads op fields, and a malformed
		// payload written through would leave the document unencodable.
		if (malformedOpMessage(op)) {
			emitMalformedOpDiagnostic(pipeline, op);
			continue;
		}

		const blockId = opBlockId(pipeline, op);

		if (!validateOp(pipeline, op)) continue;

		if (op.type === "insert-block") {
			// The executor builds a fresh block map and sets it unconditionally,
			// so an insert naming a live block replaces its text, props, and
			// meta, and normalization then strips the duplicate order entry —
			// silent content loss. An id is claimed once per document.
			if (liveInBatch(pipeline, batch, op.blockId)) {
				emitPipelineDiagnostic(pipeline, {
					code: "PEN_APPLY_010",
					level: "warn",
					source: "apply",
					message: `apply: skipping insert-block for already-present block "${op.blockId}"`,
				});
				continue;
			}
			pendingBlockTypes.set(op.blockId, op.blockType);
		}

		const nextOp =
			op.type === "insert-block" || op.type === "set-props"
				? rewriteBlockOpProps(pipeline, op, pendingBlockTypes)
				: op;

		if (
			blockId &&
			nextOp.type !== "insert-block" &&
			!liveInBatch(pipeline, batch, blockId)
		) {
			emitPipelineDiagnostic(pipeline, {
				code: "PEN_APPLY_003",
				level: "warn",
				source: "apply",
				message: `apply: skipping ${op.type} for non-existent block "${blockId}"`,
			});
			continue;
		}

		const missingParent = missingParentId(pipeline, nextOp, batch);
		if (missingParent !== null) {
			// Executing it would write the block outside the tree: insert leaves
			// an orphan, move detaches the block from wherever it was.
			emitPipelineDiagnostic(pipeline, {
				code: "PEN_APPLY_003",
				level: "warn",
				source: "apply",
				message: `apply: skipping ${nextOp.type} into non-existent parent "${missingParent}"`,
			});
			continue;
		}

		recordBatchLiveness(batch, nextOp);
		validatedOps.push(nextOp);
	}

	if (validatedOps.length === 0) {
		pipeline._commitDiagnostics = [];
		emitApplyBoundary(pipeline, {
			phase: "after",
			ops: transformedOps,
			origin,
			applied: false,
		});
		return;
	}

	recordPhase(pipeline, "execute");
	pipeline._suppressObserver = true;

	try {
		pipeline._adapter.transact(
			pipeline._crdtDoc,
			() => {
				if (structural) {
					tagStructuralOrigin(pipeline, structural);
				}
				for (const op of validatedOps) {
					try {
						const affected = executeSingleOp(pipeline, op);
						affectedBlocks.push(...affected);
					} catch (err) {
						emitMalformedOpDiagnostic(pipeline, op, err);
					}
				}

				for (const blockId of affectedBlocks) {
					pipeline._engine.markDirty(blockId);
				}

				recordPhase(pipeline, "normalize");
				pipeline._engine.normalizeDirty();
			},
			toStructuredOrigin(origin),
		);
	} finally {
		pipeline._suppressObserver = false;
	}

	const event: CRDTEvent = {
		origin,
		affectedBlocks: [...new Set(affectedBlocks)],
		ops: validatedOps,
		timestamp: Date.now(),
		source: resolveCommitSource(origin, "apply"),
	};

	pipeline._onDidApply?.(event);
	emitApplyBoundary(pipeline, {
		phase: "after",
		ops: validatedOps,
		origin,
		applied: true,
	});
}

/**
 * Block liveness as the batch has left it so far. Validation runs before any
 * op executes, so the document alone answers for the state before the batch;
 * an op later in the batch sees the inserts and deletes validated before it.
 */
type BatchLiveness = {
	readonly inserted: Set<string>;
	readonly deleted: Set<string>;
};

function liveInBatch(
	pipeline: ApplyPipelineInternal,
	batch: BatchLiveness,
	blockId: string,
): boolean {
	if (batch.inserted.has(blockId)) return true;
	if (batch.deleted.has(blockId)) return false;
	return blockExists(pipeline, blockId);
}

function recordBatchLiveness(batch: BatchLiveness, op: DocumentOp): void {
	if (op.type === "insert-block") {
		batch.inserted.add(op.blockId);
		batch.deleted.delete(op.blockId);
	} else if (op.type === "delete-block") {
		batch.deleted.add(op.blockId);
		batch.inserted.delete(op.blockId);
	}
}

/** The parent an insert or move targets when that parent is not live at that point in the batch. */
function missingParentId(
	pipeline: ApplyPipelineInternal,
	op: DocumentOp,
	batch: BatchLiveness,
): string | null {
	if (op.type !== "insert-block" && op.type !== "move-block") return null;
	const position = op.position;
	if (typeof position !== "object" || !("parent" in position)) return null;
	const parent = position.parent;
	return liveInBatch(pipeline, batch, parent) ? null : parent;
}

function emitApplyBoundary(
	pipeline: ApplyPipelineInternal,
	event: {
		phase: "before" | "after";
		ops: readonly DocumentOp[];
		origin: OpOrigin;
		applied: boolean;
	},
): void {
	for (const hook of pipeline._applyBoundaryHooks) {
		try {
			hook({
				...event,
				origin: snapshotOrigin(event.origin),
			});
		} catch (err) {
			emitPipelineDiagnostic(pipeline, {
				code: "PEN_APPLY_008",
				level: "error",
				source: "apply",
				message: "apply boundary hook threw",
				remediation:
					"Update the apply boundary hook to avoid throwing during transaction lifecycle notifications.",
				error: err,
			});
		}
	}
}

function validateOp(pipeline: ApplyPipelineInternal, op: DocumentOp): boolean {
	const rejectedKeys = [...new Set(rejectedOwnPropKeys(op))];
	if (rejectedKeys.length > 0) {
		emitPipelineDiagnostic(pipeline, {
			code: "PEN_APPLY_009",
			level: "warn",
			source: "apply",
			message: `apply: rejected prototype keys in ${op.type} (${rejectedKeys.join(", ")})`,
			remediation:
				"Remove __proto__, constructor, and prototype own keys from op props.",
			op,
		});
		return false;
	}
	switch (op.type) {
		case "insert-block": {
			if (!isRegisteredBlockType(pipeline._registry, op.blockType)) {
				emitPipelineDiagnostic(pipeline, {
					code: "PEN_APPLY_002",
					level: "warn",
					source: "apply",
					message: `Unknown block type: "${op.blockType}"`,
					op,
				});
				return false;
			}
			return true;
		}
		case "set-props": {
			if (typeof op.props.type === "string") {
				if (!isRegisteredBlockType(pipeline._registry, op.props.type)) {
					emitPipelineDiagnostic(pipeline, {
						code: "PEN_APPLY_002",
						level: "warn",
						source: "apply",
						message: `Unknown block type: "${op.props.type}"`,
						op,
					});
					return false;
				}
			}
			return true;
		}
		case "splice-text": {
			const items = Array.isArray(op.insert) ? op.insert : [op.insert];
			if (!items.every(isInlineInsert)) {
				return true;
			}
			for (const item of items) {
				if (typeof item === "string") {
					continue;
				}
				const schema = pipeline._registry.resolveInline(item.nodeType);
				if (!schema || schema.kind !== "node") {
					emitPipelineDiagnostic(pipeline, {
						code: "PEN_APPLY_002",
						level: "warn",
						source: "apply",
						message: `Unknown inline node type: "${item.nodeType}"`,
						op,
					});
					return false;
				}
			}
			return true;
		}
		case "format-text":
		case "delete-block":
		case "move-block":
		case "set-meta":
		case "grid":
		case "app":
		case "stream-open":
			return true;
		default: {
			const _exhaustive: never = op;
			void _exhaustive;
			return true;
		}
	}
}

function executeSingleOp(
	pipeline: ApplyPipelineInternal,
	op: DocumentOp,
): string[] {
	switch (op.type) {
		case "insert-block":
			return insertBlock(pipeline, op);
		case "delete-block":
			return deleteBlock(pipeline, op);
		case "move-block":
			return moveBlock(pipeline, op);
		case "set-props":
			return setProps(pipeline, op);
		case "splice-text":
			return spliceText(pipeline, op);
		case "format-text":
			return formatText(pipeline, op);
		case "set-meta":
			return setMeta(pipeline, op);
		case "grid":
			return tableOp(pipeline, op);
		case "app":
			return applyApp(pipeline, op);
		case "stream-open":
			return [];
		default: {
			const _exhaustive: never = op;
			return _exhaustive;
		}
	}
}
