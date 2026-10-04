import type {
	AttributionRange,
	Awareness,
	CRDTAdapter,
	CRDTDocument,
	LoadDocumentOptions,
} from "@input/pen-types";
import * as Y from "yjs";

import {
	BLOCKS,
	asYjsDoc,
	createYjsDocument,
	getDocumentProfile as getPersistedDocumentProfile,
	initBlockMap,
	setDocumentProfile as setPersistedDocumentProfile,
} from "./document";
import type { BlockContentType, YjsCRDTDocument } from "./document";
import {
	createObserver,
	createRemoteUpdateOrigin,
	normalizeTransactionOrigin,
} from "./events";
import { refreshFormatStamp } from "./formatStamp";
import type { CRDTDiagnostic, RecoveredMethod } from "./loadDocument";
import { loadYjsDocument } from "./loadDocument";
import {
	documentSizeDiagnosticFields,
	sampleDocumentSizeIfDue,
} from "./documentSize";
import {
	createYjsSnapshot,
	forkDocument,
	mergeDocuments,
	mergeYjsUpdates,
	restoreYjsSnapshot,
} from "./snapshots";
import {
	createRelativePosition,
	resolveRelativePosition,
} from "./relativePosition";
import { createYjsUndoManager } from "./undo";

export type { CRDTDiagnostic } from "./loadDocument";

export interface YjsAdapterOptions {
	gc?: boolean;
	onDiagnostic?: (diagnostic: CRDTDiagnostic) => void;
	onRecovered?: (method: RecoveredMethod) => void;
	/**
	 * Awareness factory, normally `createYjsAwareness` from
	 * `@input/pen-yjs/awareness`. Absent: the adapter creates no awareness and
	 * `editor.internals.awareness` stays `null` until an extension (the
	 * multiplayer extension) ensures one for its scope (API2).
	 */
	awareness?: YjsAwarenessFactory;
}

/** Builds a scope's awareness from its Yjs document. */
export type YjsAwarenessFactory = (doc: YjsCRDTDocument) => Awareness;

interface YTextItem {
	id: { client: number };
	content: { getLength(): number };
	right: YTextItem | null;
	deleted: boolean;
}

function maybeEmitDocumentSizeOnCadence(
	ydoc: Y.Doc,
	emitDiagnostic: (diagnostic: CRDTDiagnostic) => void,
): void {
	const size = sampleDocumentSizeIfDue(ydoc);
	if (!size) {
		return;
	}
	emitDiagnostic(documentSizeDiagnosticFields(size));
}

export function yjsAdapter(options?: YjsAdapterOptions): CRDTAdapter {
	const emitDiagnostic = options?.onDiagnostic ?? (() => {});

	const adapter: CRDTAdapter = {
		createDocument() {
			const doc = createYjsDocument(adapter, options);
			refreshFormatStamp(doc);
			return doc;
		},

		loadDocument(binary: Uint8Array, loadOptions?: LoadDocumentOptions) {
			return loadYjsDocument(adapter, binary, {
				gc: options?.gc,
				repair: loadOptions?.repair,
				onDiagnostic: emitDiagnostic,
				onRecovered: options?.onRecovered,
			});
		},

		encodeState(doc) {
			return Y.encodeStateAsUpdate(asYjsDoc(doc).ydoc);
		},

		encodeUpdate(doc, since?) {
			if (since) {
				return Y.encodeStateAsUpdate(asYjsDoc(doc).ydoc, since);
			}
			return Y.encodeStateAsUpdate(asYjsDoc(doc).ydoc);
		},

		applyUpdate(doc, update) {
			const ydoc = asYjsDoc(doc).ydoc;
			try {
				Y.applyUpdate(ydoc, update, createRemoteUpdateOrigin());
			} catch (err) {
				emitDiagnostic({
					code: "MALFORMED_UPDATE",
					message: `Failed to apply CRDT update: ${err instanceof Error ? err.message : String(err)}`,
					severity: "error",
					updateSize: update.byteLength,
					timestamp: Date.now(),
				});
			}
			maybeEmitDocumentSizeOnCadence(ydoc, emitDiagnostic);
		},

		transact(doc, fn, origin?) {
			refreshFormatStamp(doc);
			const normalized = normalizeTransactionOrigin(
				origin ?? "user",
				true,
			);
			if (normalized.diagnostic) {
				emitDiagnostic(normalized.diagnostic);
			}
			const ydoc = asYjsDoc(doc).ydoc;
			ydoc.transact(fn, normalized.origin);
			maybeEmitDocumentSizeOnCadence(ydoc, emitDiagnostic);
		},

		observe(doc, callback) {
			return createObserver(asYjsDoc(doc), callback, emitDiagnostic);
		},

		getClientId(doc) {
			return asYjsDoc(doc).ydoc.clientID;
		},

		isBlockDeleted(doc, blockId) {
			return isMapKeyDeleted(asYjsDoc(doc).ydoc.getMap(BLOCKS), blockId);
		},

		getDocumentProfile(doc) {
			return getPersistedDocumentProfile(doc);
		},

		setDocumentProfile(doc, profile) {
			refreshFormatStamp(doc);
			setPersistedDocumentProfile(doc, profile);
		},

		raw<T>(doc: CRDTDocument): T {
			return asYjsDoc(doc).ydoc as unknown as T;
		},

		createMap() {
			return new Y.Map<unknown>();
		},

		createArray() {
			return new Y.Array<unknown>();
		},

		createText() {
			return new Y.Text();
		},

		initBlockMap(
			doc: CRDTDocument,
			blockId: string,
			blockType: string,
			contentType: BlockContentType,
		) {
			const blocks = asYjsDoc(doc).penDocument.blocks;
			return initBlockMap(blocks, blockId, blockType, contentType);
		},

		createUndoManager(doc, undoOptions?) {
			return createYjsUndoManager(asYjsDoc(doc), undoOptions);
		},


		createSnapshot(doc) {
			return createYjsSnapshot(asYjsDoc(doc));
		},

		restoreSnapshot(doc, snapshot) {
			return restoreYjsSnapshot(adapter, asYjsDoc(doc), snapshot);
		},

		mergeUpdates(updates) {
			return mergeYjsUpdates(updates);
		},

		fork(doc) {
			return forkDocument(adapter, asYjsDoc(doc), options);
		},

		merge(target, source) {
			mergeDocuments(asYjsDoc(target), asYjsDoc(source));
		},

		getAttributionRanges(doc, blockId) {
			const yjsDoc = asYjsDoc(doc);
			const blockMap = yjsDoc.penDocument.blocks.get(blockId) as
				| Y.Map<unknown>
				| undefined;
			if (!blockMap) return [];
			const content = blockMap.get("content");
			if (!(content instanceof Y.Text)) return [];

			const ranges: AttributionRange[] = [];
			let offset = 0;
			let item = (content as unknown as { _start: YTextItem | null })
				._start;

			while (item) {
				if (!item.deleted) {
					const length = item.content.getLength();
					if (length > 0) {
						const previousRange = ranges[ranges.length - 1];
						if (
							previousRange &&
							previousRange.clientId === item.id.client &&
							previousRange.offset + previousRange.length ===
								offset
						) {
							previousRange.length += length;
						} else {
							ranges.push({
								offset,
								length,
								clientId: item.id.client,
							});
						}
						offset += length;
					}
				}
				item = item.right;
			}

			return ranges;
		},

		createRelativePosition(doc, target, assoc) {
			return createRelativePosition(doc, target, assoc);
		},

		resolveRelativePosition(doc, encoded, options) {
			return resolveRelativePosition(doc, encoded, options);
		},
	};

	const awarenessFactory = options?.awareness;
	if (awarenessFactory) {
		adapter.createAwareness = (doc) => awarenessFactory(asYjsDoc(doc));
	}

	return adapter;
}

/**
 * A Y.Map keeps the item that last wrote each key, deleted or not; a key it
 * has never integrated — a block map still in flight from another client —
 * has no item at all. `_map` is the Yjs field `Y.Map#has` itself reads.
 */
function isMapKeyDeleted(map: Y.Map<unknown>, key: string): boolean {
	const item = (map as unknown as { _map: Map<string, { deleted: boolean }> })
		._map.get(key);
	return item !== undefined && item.deleted;
}
