import type { ChangeSummary, CRDTEvent, PenDocument } from "@input/pen-types";
import { createSummarySource, type RawCommitDelta } from "@input/pen-yjs";

import {
	createBlockIndex,
	emptyBlockIndexSnapshot,
	type BlockIndex,
	type StoredBlockReader,
} from "./blockIndex";
import { createBlockIndexSnapshotFromDocument } from "./fromDocument";
import { summaryTouchedBlockIds } from "./affectedBlocks";
import { buildChangeSummary } from "./summaryBuilder";

export interface ChangeSummaryHost {
	_doc: PenDocument;
	_crdtDoc: unknown;
	_pendingSummary: ChangeSummary | null;
	_lastChangeSummary: ChangeSummary | null;
	_blockIndex: BlockIndex;
	_unsubSummary: (() => void) | null;
	_deferredCRDTEvent: CRDTEvent | null;
	_engine: {
		observeCommit(
			delta: RawCommitDelta,
			localApply: boolean,
			readBlock: StoredBlockReader,
		): void;
		notifyExternalCommit(blockIds: Iterable<string>): void;
	};
	_pipeline: { readonly suppressObserver: boolean };
	_dispatchCRDTEvent(event: CRDTEvent): void;
}

export function installChangeSummaries(host: ChangeSummaryHost): void {
	teardownChangeSummaries(host);
	host._pendingSummary = null;
	host._lastChangeSummary = null;
	host._deferredCRDTEvent = null;
	host._blockIndex = createBlockIndex(
		host._doc
			? createBlockIndexSnapshotFromDocument(host._doc)
			: emptyBlockIndexSnapshot(),
	);
	try {
		host._unsubSummary = createSummarySource(
			host._crdtDoc as never,
			(delta) => {
				const readBlock = storedBlockReader(host._doc);
				// A local apply advanced the normalizer's pass index at each
				// write; a remote or undo transaction advances it by its delta.
				host._engine.observeCommit(
					delta,
					host._pipeline.suppressObserver,
					readBlock,
				);
				const summary = buildChangeSummary(
					delta,
					host._blockIndex.snapshot(),
					0,
					{
						blockExists: (blockId) => readBlock(blockId) !== undefined,
						listedMoreThanOnce: (blockId) =>
							host._blockIndex.listedMoreThanOnce(blockId),
					},
				);
				host._pendingSummary = summary;
				// A local apply normalized inside its own transaction; any
				// other commit hands the next local pass what it touched.
				if (!host._pipeline.suppressObserver) {
					const touched = structurallyTouchedBlockIds(delta, summary);
					if (touched.size > 0) host._engine.notifyExternalCommit(touched);
				}
				// A text-only commit moves lengths and nothing else, so the
				// index advances in place. Rebuilding it from the document
				// would read every block's text on every keystroke (SCALE2). An
				// array edit, or a block map arriving or leaving, that reports no
				// structural change (a duplicate entry's repair, an orphan whose
				// parent a peer deleted; COL4) still reshapes the index, which
				// advances by the arrays and maps the delta names; a commit it
				// cannot advance exactly is read back from the document.
				if (summary.structural.length === 0 && !reshapesIndex(delta)) {
					host._blockIndex.applyTextLengths(summary.blockText);
				} else {
					const named = namedBlockIds(summary);
					if (!host._blockIndex.applyStructure(readBlock, delta, named)) {
						host._blockIndex.replace(
							createBlockIndexSnapshotFromDocument(host._doc, {
								lengths: host._blockIndex.snapshot().lengthById,
								named,
							}),
						);
					}
				}
				flushDeferredCRDTEvent(host);
			},
		);
	} catch {
		host._unsubSummary = null;
	}
}

export function teardownChangeSummaries(host: ChangeSummaryHost): void {
	host._deferredCRDTEvent = null;
	if (!host._unsubSummary) return;
	host._unsubSummary();
	host._unsubSummary = null;
}

/**
 * One commit's reads of stored block maps, shared by the pass index, the
 * summary and the block index so each map is read once (SCALE2). The document
 * does not change while the commit's observers run.
 */
function storedBlockReader(doc: PenDocument): StoredBlockReader {
	const reads = new Map<string, unknown>();
	return (blockId) => {
		if (reads.has(blockId)) return reads.get(blockId);
		const block = doc.blocks.get(blockId);
		reads.set(blockId, block);
		return block;
	};
}

function flushDeferredCRDTEvent(host: ChangeSummaryHost): void {
	const deferred = host._deferredCRDTEvent;
	if (!deferred) return;
	host._deferredCRDTEvent = null;
	host._dispatchCRDTEvent(deferred);
}

/** Whether a commit edited an order array or added or removed a block map. */
function reshapesIndex(delta: RawCommitDelta): boolean {
	if (delta.blockOrderDelta.length > 0 || delta.childArrayDeltas.size > 0) {
		return true;
	}
	for (const keys of delta.blockMapChanges.values()) {
		if (keys.size === 0) return true;
	}
	return false;
}

/** Keys of a block map whose change can move the block in the tree. */
const STRUCTURAL_BLOCK_KEYS: ReadonlySet<string> = new Set([
	"parentId",
	"props",
	"children",
]);

/**
 * Blocks a commit placed, re-parented, created, removed, or deleted: ids
 * inserted into `blockOrder` or a `children` array, the owners of changed
 * `children` arrays, block-map entries that changed whole or changed
 * `parentId`, and the ids the summary reports removed or moved — an entry
 * removed under a peer's concurrent move can leave a live block in no array.
 * Read from the delta and summary alone, so it costs nothing per document block.
 */
function structurallyTouchedBlockIds(
	delta: RawCommitDelta,
	summary: ChangeSummary,
): Set<string> {
	const touched = new Set<string>();
	for (const change of summary.structural) {
		if (change.type === "block-removed" || change.type === "block-moved") {
			touched.add(change.blockId);
		}
	}
	const addInserted = (ops: RawCommitDelta["blockOrderDelta"]): void => {
		for (const op of ops) {
			for (const id of op.insert ?? []) {
				if (typeof id === "string") touched.add(id);
			}
		}
	};
	addInserted(delta.blockOrderDelta);
	for (const [ownerId, ops] of delta.childArrayDeltas) {
		touched.add(ownerId);
		addInserted(ops);
	}
	for (const [blockId, keys] of delta.blockMapChanges) {
		if (keys.size === 0) {
			touched.add(blockId);
			continue;
		}
		for (const key of keys) {
			if (STRUCTURAL_BLOCK_KEYS.has(key)) {
				touched.add(blockId);
				break;
			}
		}
	}
	return touched;
}

/** Blocks whose text a structural commit may have changed, so must be re-read. */
function namedBlockIds(summary: ChangeSummary): Set<string> {
	const named = new Set(summaryTouchedBlockIds(summary));
	for (const change of summary.blockText) named.add(change.blockId);
	for (const change of summary.structural) {
		if (change.type === "block-split") named.add(change.newBlockId);
		else if (change.type === "blocks-merged") named.add(change.targetBlockId);
	}
	return named;
}
