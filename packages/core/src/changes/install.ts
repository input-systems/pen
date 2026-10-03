import type { ChangeSummary, CRDTEvent, PenDocument } from "@input/pen-types";
import { createSummarySource } from "@input/pen-yjs";

import {
	createBlockIndex,
	emptyBlockIndexSnapshot,
	type BlockIndex,
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
	_engine: { notifyStructureChanged(): void };
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
				// Normalization only runs inside a local apply, so a remote or
				// undo transaction is the one structural change its pass index
				// never hears about at the mutation site.
				if (
					delta.blockOrderDelta.length > 0 ||
					delta.childArrayDeltas.size > 0
				) {
					host._engine.notifyStructureChanged();
				}

				const summary = buildChangeSummary(
					delta,
					host._blockIndex.snapshot(),
					0,
					(blockId) => host._doc.blocks.has(blockId),
				);
				host._pendingSummary = summary;
				// A text-only commit moves lengths and nothing else, so the
				// index advances in place. Rebuilding it from the document
				// would read every block's text on every keystroke (SCALE2).
				if (summary.structural.length === 0) {
					host._blockIndex.applyTextLengths(summary.blockText);
				} else {
					host._blockIndex.replace(
						createBlockIndexSnapshotFromDocument(host._doc, {
							lengths: host._blockIndex.snapshot().lengthById,
							named: namedBlockIds(summary),
						}),
					);
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

function flushDeferredCRDTEvent(host: ChangeSummaryHost): void {
	const deferred = host._deferredCRDTEvent;
	if (!deferred) return;
	host._deferredCRDTEvent = null;
	host._dispatchCRDTEvent(deferred);
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
