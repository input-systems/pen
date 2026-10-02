import type {
	CRDTEvent,
	OpOriginType,
	StructuredOpOrigin,
	Unsubscribe,
} from "@input/pen-types";
import { HISTORY_ORIGIN_TAG } from "@input/pen-types";
import * as Y from "yjs";

import { BLOCKS, BLOCK_ORDER } from "./document";
import type { YjsCRDTDocument } from "./document";
import type { CRDTDiagnostic } from "./loadDocument";
import { YJS_SINGLETON_MISMATCH, YJS_SINGLETON_MISMATCH_CODE } from "./yjsSingleton";

// Yjs internal types inferred from Yjs APIs to avoid leaking `any`.
type AnyAbstractType = Parameters<Y.Transaction["changed"]["get"]>[0];

export const ORIGIN_UNKNOWN_CODE = "ORIGIN_UNKNOWN";
export const HISTORY_OPERATION_KIND = "__pen_history_kind";

const CANONICAL_ORIGINS: {
	[Type in OpOriginType]: StructuredOpOrigin;
} = {
	user: { type: "user" },
	ai: { type: "ai" },
	"ai-session": { type: "ai-session" },
	"suggestion-resolution": { type: "suggestion-resolution" },
	collaborator: { type: "collaborator" },
	extension: { type: "extension" },
	history: { type: "history" },
	"input-rule": { type: "input-rule" },
	app: { type: "app" },
	import: { type: "import" },
	system: { type: "system" },
	migration: { type: "migration" },
};

/** Stable token so Y.UndoManager can track structured origins by identity. */
export function canonicalOrigin(type: OpOriginType): StructuredOpOrigin {
	return CANONICAL_ORIGINS[type];
}

function isOpOriginType(value: string): value is OpOriginType {
	switch (value) {
		case "user":
		case "ai":
		case "ai-session":
		case "suggestion-resolution":
		case "collaborator":
		case "extension":
		case "history":
		case "input-rule":
		case "app":
		case "import":
		case "system":
		case "migration":
			return true;
		default:
			return false;
	}
}

function isHistoryOrigin(origin: unknown): boolean {
	if (origin instanceof Y.UndoManager) return true;
	if (
		origin != null &&
		typeof origin === "object" &&
		(origin as Record<string, unknown>)[HISTORY_ORIGIN_TAG] === true
	) {
		return true;
	}
	return false;
}

function isStructuredOpOrigin(origin: unknown): origin is StructuredOpOrigin {
	return (
		typeof origin === "object" &&
		origin !== null &&
		typeof (origin as { type?: unknown }).type === "string"
	);
}

function rawOriginSource(origin: unknown): string {
	if (typeof origin === "string") return origin;
	if (origin == null) return "absent";
	if (isStructuredOpOrigin(origin)) return origin.type;
	return "unrecognized";
}

function unknownOriginDiagnostic(source: string): CRDTDiagnostic {
	return {
		code: ORIGIN_UNKNOWN_CODE,
		message: `Unknown transaction origin "${source}" normalized to { type: "system" }`,
		severity: "warning",
		timestamp: Date.now(),
	};
}

export function createRemoteUpdateOrigin(
	handle?: Pick<
		StructuredOpOrigin,
		"actorId" | "source" | "groupId" | "requestId"
	>,
): StructuredOpOrigin {
	if (
		handle == null ||
		(handle.actorId == null &&
			handle.source == null &&
			handle.groupId == null &&
			handle.requestId == null)
	) {
		return canonicalOrigin("collaborator");
	}
	return {
		type: "collaborator",
		...handle,
	};
}

export interface NormalizedTransactionOrigin {
	readonly origin: StructuredOpOrigin;
	readonly diagnostic: CRDTDiagnostic | null;
}

export function normalizeTransactionOrigin(
	origin: unknown,
	local = true,
): NormalizedTransactionOrigin {
	if (!local) {
		if (isStructuredOpOrigin(origin) && origin.type === "collaborator") {
			return { origin, diagnostic: null };
		}
		const handle = isStructuredOpOrigin(origin)
			? {
					actorId: origin.actorId,
					groupId: origin.groupId,
					requestId: origin.requestId,
					source: origin.source,
				}
			: typeof origin === "string"
				? { source: origin }
				: undefined;
		return { origin: createRemoteUpdateOrigin(handle), diagnostic: null };
	}

	if (origin === null || origin === undefined) {
		return {
			origin: { type: "system", source: "absent" },
			diagnostic: unknownOriginDiagnostic("absent"),
		};
	}

	if (isHistoryOrigin(origin)) {
		const kind =
			origin != null && typeof origin === "object"
				? (origin as Record<string, unknown>)[HISTORY_OPERATION_KIND]
				: undefined;
		return {
			origin:
				kind === "redo"
					? { type: "history", source: "redo" }
					: { type: "history", source: "undo" },
			diagnostic: null,
		};
	}

	if (typeof origin === "string") {
		if (isOpOriginType(origin)) {
			return { origin: canonicalOrigin(origin), diagnostic: null };
		}
		return {
			origin: { type: "system", source: origin },
			diagnostic: unknownOriginDiagnostic(origin),
		};
	}

	if (isStructuredOpOrigin(origin)) {
		if (isOpOriginType(origin.type)) {
			return { origin, diagnostic: null };
		}
		return {
			origin: { type: "system", source: origin.type },
			diagnostic: unknownOriginDiagnostic(origin.type),
		};
	}

	return {
		origin: { type: "system", source: "unrecognized" },
		diagnostic: unknownOriginDiagnostic("unrecognized"),
	};
}

/** Always structured. String origins are not stored downstream. */
export function originToOpOrigin(
	origin: unknown,
	local = true,
): StructuredOpOrigin {
	return normalizeTransactionOrigin(origin, local).origin;
}

function resolveBlockId(
	ytype: AnyAbstractType,
	blocksMap: Y.Map<Y.Map<unknown>>,
): string | null {
	let current: AnyAbstractType | null = ytype;
	while (current != null) {
		const item = (
			current as { _item?: { parent: unknown; parentSub: string | null } }
		)._item;
		if (item == null) break;
		if (item.parent === blocksMap && item.parentSub != null) {
			return item.parentSub;
		}
		current = item.parent as unknown as AnyAbstractType | null;
	}
	return null;
}

function extractAffectedBlocks(txn: Y.Transaction): string[] {
	const blockIds = new Set<string>();
	const blocksMap = txn.doc.getMap(BLOCKS) as Y.Map<Y.Map<unknown>>;
	const blockOrderArray = txn.doc.getArray(BLOCK_ORDER);

	for (const [ytype, keys] of txn.changed) {
		if ((ytype as unknown) === (blocksMap as unknown)) {
			for (const key of keys) {
				if (key !== null) blockIds.add(key);
			}
			continue;
		}
		if ((ytype as unknown) === (blockOrderArray as unknown)) {
			const arr = blockOrderArray.toArray() as string[];
			for (const id of arr) blockIds.add(id);
			continue;
		}
		const blockId = resolveBlockId(ytype, blocksMap);
		if (blockId) blockIds.add(blockId);
	}

	return Array.from(blockIds);
}

const foreignCopyReported = new WeakSet<Y.Doc>();

export function createObserver(
	doc: YjsCRDTDocument,
	callback: (event: CRDTEvent) => void,
	onDiagnostic?: (diagnostic: CRDTDiagnostic) => void,
): Unsubscribe {
	// API2: a transaction that is not this module's Y.Transaction was opened
	// by a second yjs copy — a provider applying updates with its own
	// applyUpdate, usually its initial sync. Report it once per document
	// rather than throwing from an observer.
	const beforeHandler = (txn: unknown) => {
		if (txn instanceof Y.Transaction || foreignCopyReported.has(doc.ydoc)) {
			return;
		}
		foreignCopyReported.add(doc.ydoc);
		onDiagnostic?.({
			code: YJS_SINGLETON_MISMATCH_CODE,
			message: YJS_SINGLETON_MISMATCH,
			severity: "error",
			timestamp: Date.now(),
		});
	};
	const txnHandler = (txn: Y.Transaction) => {
		if (txn.changed.size === 0) {
			return;
		}

		const normalized = normalizeTransactionOrigin(txn.origin, txn.local);
		if (normalized.diagnostic) {
			onDiagnostic?.(normalized.diagnostic);
		}

		const event: CRDTEvent = {
			origin: normalized.origin,
			affectedBlocks: extractAffectedBlocks(txn),
			ops: [],
			timestamp: Date.now(),
		};
		callback(event);
	};

	doc.ydoc.on("beforeTransaction", beforeHandler);
	doc.ydoc.on("afterTransaction", txnHandler);

	return () => {
		doc.ydoc.off("beforeTransaction", beforeHandler);
		doc.ydoc.off("afterTransaction", txnHandler);
	};
}
