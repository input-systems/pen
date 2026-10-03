import {
	buildLazyNormalPositionSnapshot,
	getEditorSelectionRecord,
	type NormalPositionSnapshot,
} from "@input/pen-core";
import { getRootGeometry } from "@input/pen-dom";
import { validateDocument } from "@input/pen-yjs";
import type { Editor, Point } from "@input/pen-types";
import * as Y from "yjs";
import { nextNormalPosition } from "../../../../core/src/selection/normalPosition";
import type {
	DomAuthorityCheck,
	FuzzBlockView,
	FuzzCheckReport,
	FuzzDocumentCheck,
	FuzzNormalPositionCheck,
	SerializedDiagnostic,
} from "../../src/types";

/**
 * Browser half of the DOM fuzzer's per-step check (W3.R19 §3.15). It only
 * observes; `src/fuzz/dom/invariants.ts` decides what fails.
 */
export function collectFuzzReport(input: {
	editor: Editor;
	localY: Y.Doc;
	remoteY: Y.Doc;
	s2: DomAuthorityCheck;
	diagnostics: SerializedDiagnostic[];
}): FuzzCheckReport {
	const snapshot = buildLazyNormalPositionSnapshot(input.editor);
	const record = getEditorSelectionRecord(input.editor);
	return {
		s2: input.s2,
		s5: checkNormalPositions(snapshot, input.editor),
		record: record
			? { version: record.version, commitId: record.commitId }
			: null,
		diagnostics: input.diagnostics,
		documents: checkDocuments(input.localY, input.remoteY),
		blocks: blockViews(input.editor, snapshot),
	};
}

function blockViews(
	editor: Editor,
	snapshot: NormalPositionSnapshot,
): FuzzBlockView[] {
	return snapshot.blockOrder.map((id) => ({
		id,
		type: editor.getBlock(id)?.type ?? "unknown",
		length: editor.getBlock(id)?.length() ?? 0,
		kind: snapshot.blocks[id]?.kind ?? "structural",
	}));
}

/** S5: each text endpoint is reached by stepping `nextNormalPosition` from offset 0. */
function checkNormalPositions(
	snapshot: NormalPositionSnapshot,
	editor: Editor,
): FuzzNormalPositionCheck {
	const state = editor.selection;
	if (state?.type !== "text") {
		return { ok: true };
	}
	for (const point of [state.anchor, state.focus]) {
		if (!reachableFromBlockStart(snapshot, point)) {
			return {
				ok: false,
				reason: `${point.blockId}@${point.offset} is not reached from offset 0`,
			};
		}
	}
	return { ok: true };
}

function reachableFromBlockStart(
	snapshot: NormalPositionSnapshot,
	target: Point,
): boolean {
	let current: Point = { blockId: target.blockId, offset: 0 };
	if (snapshot.blocks[target.blockId]?.kind !== "text") {
		return false;
	}
	while (current.offset < target.offset) {
		const next = nextNormalPosition(snapshot, current, 1);
		if (
			next === null ||
			"blockBoundary" in next ||
			next.offset <= current.offset
		) {
			return false;
		}
		current = next;
	}
	return current.offset === target.offset;
}

function validationErrors(ydoc: Y.Doc): string[] {
	return validateDocument(ydoc)
		.errors.filter((error) => error.severity === "error")
		.map((error) => `${error.code}: ${error.message}`);
}

function checkDocuments(localY: Y.Doc, remoteY: Y.Doc): FuzzDocumentCheck {
	const local = Y.encodeStateVector(localY);
	const remote = Y.encodeStateVector(remoteY);
	return {
		localErrors: validationErrors(localY),
		remoteErrors: validationErrors(remoteY),
		stateVectorsEqual:
			local.length === remote.length &&
			local.every((byte, index) => byte === remote[index]),
	};
}

/** Enough flushes to drain a projection that queues one follow-up write per flush. */
const IDLE_FLUSH_LIMIT = 8;

type SchedulerQueues = { rafHandle: number | null };

/**
 * `whenIdle` (W3.R19): resolve after a scheduler flush that left nothing
 * queued. Test-side: a flush is forced by queueing an empty write, and the
 * scheduler's private frame handle says whether that flush scheduled another.
 */
export async function whenSchedulerIdle(
	root: HTMLElement | null,
): Promise<void> {
	if (!root) {
		return;
	}
	const scheduler = getRootGeometry(root).scheduler;
	for (let flushes = 0; flushes < IDLE_FLUSH_LIMIT; flushes += 1) {
		await scheduler.write(() => {});
		if ((scheduler as unknown as SchedulerQueues).rafHandle === null) {
			return;
		}
	}
	throw new Error(
		`whenIdle: the scheduler still had work after ${IDLE_FLUSH_LIMIT} flushes`,
	);
}
