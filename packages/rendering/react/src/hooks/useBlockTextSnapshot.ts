import { affectedBlockIdsFromSummary } from "@input/pen-core";
import { useCallback, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@input/pen-types";

import { useBlockNotifier } from "./useBlockNotifier";

interface BlockTextDelta {
	insert: string | Record<string, unknown>;
	attributes?: Readonly<Record<string, unknown>>;
}

interface BlockTextSnapshot {
	exists: boolean;
	text: string;
	deltas: readonly BlockTextDelta[];
}

const EMPTY_DELTAS: readonly BlockTextDelta[] = [];

// HOST5: empty snapshot is correct for shell-only SSR. Do not populate
// this from the live document — hosts export content with @input/pen-interop/html.
const SSR_SNAPSHOT: BlockTextSnapshot = {
	exists: false,
	text: "",
	deltas: EMPTY_DELTAS,
};

/**
 * The block's text and deltas. Notified through the root's block notifier,
 * and the text is re-read only when the block's revision moved since the
 * last read, so a render for any other reason reads nothing (SCALE6).
 */
export function useBlockTextSnapshot(editor: Editor, blockId: string): BlockTextSnapshot {
	const notifier = useBlockNotifier();
	const cacheRef = useRef<{ revision: number; exists: boolean; snapshot: BlockTextSnapshot } | null>(null);
	const subscribe = useCallback(
		(onChange: () => void) =>
			notifier
				? notifier.subscribeBlock(blockId, onChange)
				: editor.on("commit", (event) => {
						if (affectedBlockIdsFromSummary(event.summary).includes(blockId)) onChange();
					}),
		[editor, notifier, blockId],
	);
	const getSnapshot = useCallback(() => {
		const revision = editor.getBlockRevision(blockId);
		const exists = editor.getBlock(blockId) != null;
		const cached = cacheRef.current;
		if (cached && cached.revision === revision && cached.exists === exists) return cached.snapshot;
		const next = getBlockTextSnapshot(editor, blockId);
		const snapshot = cached && blockTextSnapshotEqual(cached.snapshot, next) ? cached.snapshot : next;
		cacheRef.current = { revision, exists, snapshot };
		return snapshot;
	}, [editor, blockId]);
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): BlockTextSnapshot {
	return SSR_SNAPSHOT;
}

function getBlockTextSnapshot(
	editor: Editor,
	blockId: string,
): BlockTextSnapshot {
	const block = editor.getBlock(blockId);
	if (!block) {
		return createMissingSnapshot();
	}

	return {
		exists: true,
		text: block.textContent(),
		deltas: block.inlineDeltas().map((delta) => ({
			insert:
				typeof delta.insert === "string"
					? delta.insert
					: { type: delta.insert.type, ...delta.insert.props },
			...(delta.attributes ? { attributes: delta.attributes } : {}),
		})),
	};
}

function createMissingSnapshot(): BlockTextSnapshot {
	return {
		exists: false,
		text: "",
		deltas: EMPTY_DELTAS,
	};
}

function blockTextSnapshotEqual(
	left: BlockTextSnapshot,
	right: BlockTextSnapshot,
): boolean {
	if (left.exists !== right.exists || left.text !== right.text) {
		return false;
	}
	if (left.deltas.length !== right.deltas.length) {
		return false;
	}
	for (let i = 0; i < left.deltas.length; i++) {
		if (!blockTextDeltaEqual(left.deltas[i], right.deltas[i])) {
			return false;
		}
	}
	return true;
}

function blockTextDeltaEqual(
	left: BlockTextDelta,
	right: BlockTextDelta,
): boolean {
	if (!blockTextDeltaInsertEqual(left.insert, right.insert)) {
		return false;
	}
	return shallowEqualAttributes(left.attributes, right.attributes);
}

function blockTextDeltaInsertEqual(
	left: string | Record<string, unknown>,
	right: string | Record<string, unknown>,
): boolean {
	if (typeof left === "string" || typeof right === "string") {
		return left === right;
	}

	return shallowEqualAttributes(left, right);
}

function shallowEqualAttributes(
	left: Readonly<Record<string, unknown>> | undefined,
	right: Readonly<Record<string, unknown>> | undefined,
): boolean {
	if (left === right) return true;
	if (!left || !right) return left === right;

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	for (const key of leftKeys) {
		if (left[key] !== right[key]) {
			return false;
		}
	}

	return true;
}
