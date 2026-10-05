import { affectedBlockIdsFromSummary } from "@input/pen-core";
import { useCallback, useRef, useSyncExternalStore } from "react";
import type { Editor, TableCellHandle } from "@input/pen-types";

import { useBlockNotifier } from "./useBlockNotifier";

interface CellTextDelta {
	insert: string;
	attributes?: Readonly<Record<string, unknown>>;
}

interface CellTextSnapshot {
	exists: boolean;
	text: string;
	deltas: readonly CellTextDelta[];
}

const EMPTY_DELTAS: readonly CellTextDelta[] = [];

// HOST5: empty snapshot is correct for shell-only SSR. Do not populate
// this from the live document — hosts export content with @input/pen-interop/html.
const SSR_SNAPSHOT: CellTextSnapshot = {
	exists: false,
	text: "",
	deltas: EMPTY_DELTAS,
};

/**
 * One cell's text. Inside a root it is notified through the table block's
 * notifier subscription; outside one it falls back to a commit listener.
 */
export function useCellTextSnapshot(
	editor: Editor,
	tableBlockId: string,
	row: number,
	col: number,
): CellTextSnapshot {
	const notifier = useBlockNotifier();
	const snapshotRef = useRef<CellTextSnapshot>(createMissingSnapshot());
	const subscribe = useCallback(
		(onChange: () => void) =>
			notifier
				? notifier.subscribeBlock(tableBlockId, onChange)
				: editor.on("commit", (event) => {
						if (affectedBlockIdsFromSummary(event.summary).includes(tableBlockId)) onChange();
					}),
		[editor, notifier, tableBlockId],
	);
	const getSnapshot = useCallback(() => {
		const nextSnapshot = getCellTextSnapshot(editor, tableBlockId, row, col);
		if (cellSnapshotEqual(snapshotRef.current, nextSnapshot)) {
			return snapshotRef.current;
		}
		snapshotRef.current = nextSnapshot;
		return nextSnapshot;
	}, [editor, tableBlockId, row, col]);
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function getServerSnapshot(): CellTextSnapshot {
	return SSR_SNAPSHOT;
}

function getCellTextSnapshot(
	editor: Editor,
	tableBlockId: string,
	row: number,
	col: number,
): CellTextSnapshot {
	const block = editor.getBlock(tableBlockId);
	if (!block) return createMissingSnapshot();

	const cell: TableCellHandle | null =
		block.as("table")?.tableCell(row, col) ?? null;
	if (!cell) return createMissingSnapshot();

	return {
		exists: true,
		text: cell.textContent(),
		deltas: cell.textDeltas(),
	};
}

function createMissingSnapshot(): CellTextSnapshot {
	return { exists: false, text: "", deltas: EMPTY_DELTAS };
}

function cellSnapshotEqual(
	left: CellTextSnapshot,
	right: CellTextSnapshot,
): boolean {
	if (left.exists !== right.exists || left.text !== right.text) return false;
	if (left.deltas.length !== right.deltas.length) return false;
	for (let i = 0; i < left.deltas.length; i++) {
		const l = left.deltas[i];
		const r = right.deltas[i];
		if (l.insert !== r.insert) return false;
		if (!shallowEqualAttrs(l.attributes, r.attributes)) return false;
	}
	return true;
}

function shallowEqualAttrs(
	left: Readonly<Record<string, unknown>> | undefined,
	right: Readonly<Record<string, unknown>> | undefined,
): boolean {
	if (left === right) return true;
	if (!left || !right) return left === right;
	const lk = Object.keys(left);
	const rk = Object.keys(right);
	if (lk.length !== rk.length) return false;
	for (const key of lk) {
		if (left[key] !== right[key]) return false;
	}
	return true;
}
