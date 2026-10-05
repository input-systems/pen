import { HISTORY_ORIGIN_TAG } from "@input/pen-types";
import type { FieldEditorTextChangeEvent } from "./crdt";

/**
 * Detects whether a raw CRDT transaction origin is from the undo manager.
 *
 * Uses the stable `HISTORY_ORIGIN_TAG` property instead of checking
 * `constructor.name`, which breaks under minification.
 */
export function isHistoryTransactionOrigin(origin: unknown): boolean {
	if (origin == null || typeof origin !== "object") return false;
	return (origin as Record<string, unknown>)[HISTORY_ORIGIN_TAG] === true;
}

/**
 * COL1 for raw `Y.Text` observers: a transaction is a collaborator edit when
 * it did not originate on this document (`local === false`, which is how a
 * provider's `Y.applyUpdate` arrives whatever origin object it passes), or
 * when its structured origin says `collaborator`. Mirrors
 * `normalizeTransactionOrigin` in `@input/pen-yjs`. The origin is never
 * compared to a string: the adapter stamps structured origins.
 */
export function isCollaboratorTransaction(
	transaction: FieldEditorTextChangeEvent["transaction"],
): boolean {
	if (transaction?.local === false) {
		return true;
	}
	const origin = transaction?.origin;
	return (
		origin != null &&
		typeof origin === "object" &&
		(origin as { type?: unknown }).type === "collaborator"
	);
}
