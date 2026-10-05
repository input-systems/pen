import type {
	ChangeSummary,
	CommitEvent,
	DiagnosticEvent,
	SelectionRecord,
	StructuralChange,
} from "@input/pen-types";

export type DomSchedulerPhase = "idle" | "read" | "write";

export type DomSchedulerOwner = string | { readonly rootId: string };

export type GeometryInvalidator = {
	invalidateBlocks(blockIds: readonly string[], commitId?: number): void;
};

export type FlushCollect = {
	readonly commits: readonly CommitEvent[];
	readonly selection: SelectionRecord | null;
};

export type DomSchedulerOptions = {
	onDiagnostic?: (event: DiagnosticEvent) => void;
	onInvalidate?: (blockIds: readonly string[], commitId: number) => void;
	geometry?: GeometryInvalidator;
};

type ScheduledJob = () => void;

/**
 * One per root. The overlay controller implements it (OV1): the scheduler
 * calls `read` as the last step of the read phase and `paint` as the last
 * step of the write phase, after the selection projector.
 */
export interface OverlayPainter {
	/** Read phase, after queued reads. Measures through the root's GeometryReader. */
	read(input: { readonly commits: readonly CommitEvent[] }): void;
	/** Write phase, after projectSelection. `ranWrites` is true when queued write jobs ran this flush. */
	paint(input: { readonly ranWrites: boolean }): void;
}

/** Scheduler counters. Both are counts, never clocks. */
export type DomSchedulerDiagnostics = {
	readonly measureNowCount: number;
	readonly flushCount: number;
	readonly paintCount: number;
};

/**
 * One scheduler per editor root (SCH3). Construct with that root's id or
 * owner; do not share an instance or its queues across editors.
 *
 * Verbatim contract: `read`, `write`, `measureNow`, `phase`.
 * Standalone module: not wired to editor.apply or React.
 */
export class DomScheduler {
	readonly rootId: string;
	private _phase: DomSchedulerPhase = "idle";
	private measureNowCalls = 0;
	private flushes = 0;
	private paints = 0;
	private overlayPainter: OverlayPainter | null = null;
	private readonly onDiagnostic?: (event: DiagnosticEvent) => void;
	private readonly onInvalidate?: (
		blockIds: readonly string[],
		commitId: number,
	) => void;
	private geometry: GeometryInvalidator | null;
	private readQueue: ScheduledJob[] = [];
	private writeQueue: ScheduledJob[] = [];
	private pendingCommits: CommitEvent[] = [];
	private selection: SelectionRecord | null = null;
	private _collect: FlushCollect | null = null;
	private activeReads: ScheduledJob[] | null = null;
	private activeWrites: ScheduledJob[] | null = null;
	private rafHandle: number | null = null;
	private readAfterWriteForced = false;

	constructor(owner: DomSchedulerOwner, options?: DomSchedulerOptions) {
		this.rootId = typeof owner === "string" ? owner : owner.rootId;
		this.onDiagnostic = options?.onDiagnostic;
		this.onInvalidate = options?.onInvalidate;
		this.geometry = options?.geometry ?? null;
	}

	get phase(): DomSchedulerPhase {
		return this._phase;
	}

	get diagnostics(): DomSchedulerDiagnostics {
		return {
			measureNowCount: this.measureNowCalls,
			flushCount: this.flushes,
			paintCount: this.paints,
		};
	}

	get collect(): FlushCollect | null {
		return this._collect;
	}

	acceptCommit(event: CommitEvent): void {
		this.pendingCommits.push(event);
		this.scheduleFlush();
	}

	setSelection(record: SelectionRecord | null): void {
		this.selection = record;
		this.scheduleFlush();
	}

	/** Install or clear the root's overlay painter. */
	setOverlayPainter(painter: OverlayPainter | null): void {
		this.overlayPainter = painter;
	}

	/**
	 * Schedule a flush whose only work may be an overlay read and paint.
	 * Coalesced per frame with every other pending flush (SCH, OV1).
	 */
	requestPaint(): void {
		this.scheduleFlush();
	}

	read<T>(fn: () => T): Promise<T> {
		return new Promise((resolve, reject) => {
			this.enqueueRead(() => {
				try {
					resolve(fn());
				} catch (error) {
					reject(error);
				}
			});
		});
	}

	write(fn: () => void): Promise<void> {
		return new Promise((resolve, reject) => {
			this.enqueueWrite(() => {
				try {
					fn();
					resolve();
				} catch (error) {
					reject(error);
				}
			});
		});
	}

	measureNow<T>(fn: () => T): T {
		this.measureNowCalls += 1;
		// SCH2 flush boundary: geometry cached before a commit accepted
		// since the last flush is stale now, not only at the next flush.
		// The commits stay pending; the flush still collects them.
		this.invalidatePendingGeometry();
		return fn();
	}

	private invalidatePendingGeometry(): void {
		if (this.pendingCommits.length === 0) {
			return;
		}
		const blockIds = blockIdsFromCommits(this.pendingCommits);
		if (blockIds.length === 0) {
			return;
		}
		const last = this.pendingCommits[this.pendingCommits.length - 1];
		this.geometry?.invalidateBlocks(blockIds, last?.commitId);
	}

	private enqueueRead(job: ScheduledJob): void {
		if (this._phase === "read" && this.activeReads) {
			this.activeReads.push(job);
			return;
		}

		if (this._phase === "write") {
			this.readQueue.push(job);
			if (!this.readAfterWriteForced) {
				this.readAfterWriteForced = true;
				this.onDiagnostic?.({
					code: "read-after-write",
					level: "warn",
					source: "scheduler",
					message:
						"read queued during write phase; routed to a layout-observing next-frame flush",
				});
			}
			this.scheduleFlush();
			return;
		}

		this.readQueue.push(job);
		this.scheduleFlush();
	}

	private enqueueWrite(job: ScheduledJob): void {
		if (
			(this._phase === "read" || this._phase === "write") &&
			this.activeWrites
		) {
			this.activeWrites.push(job);
			return;
		}

		this.writeQueue.push(job);
		this.scheduleFlush();
	}

	private scheduleFlush(): void {
		if (this.rafHandle != null) {
			return;
		}

		this.rafHandle = globalThis.requestAnimationFrame(() => {
			this.rafHandle = null;
			this.flush();
		});
	}

	private flush(): void {
		// Collect: commits since the last flush, the current selection
		// record, and pending read/write queues. The field editor feeds
		// acceptCommit for every commit on its editor; this module only
		// stores what callers feed it.
		this._collect = {
			commits: this.pendingCommits,
			selection: this.selection,
		};
		this.pendingCommits = [];
		// W3.R8: the scheduler retains no record past the flush that
		// collected it; a parked projection resolves on its block's ack.
		this.selection = null;
		this.activeReads = this.readQueue;
		this.activeWrites = this.writeQueue;
		this.readQueue = [];
		this.writeQueue = [];
		this.readAfterWriteForced = false;

		this.flushes += 1;

		this._phase = "read";
		this.invalidateFromCollect(this._collect);
		this.drain(this.activeReads);
		this.readOverlays(this._collect);

		this._phase = "write";
		// renderer DOM updates already committed by construction — the
		// flush is scheduled after framework commit (mount-ack). The
		// selection projector runs as a queued write, so the overlay paint
		// after the drain sees final layout and the projected selection.
		this.drain(this.activeWrites);
		this.paintOverlays(this.activeWrites.length > 0);

		this.activeReads = null;
		this.activeWrites = null;
		this._phase = "idle";

		if (
			this.readQueue.length > 0 ||
			this.writeQueue.length > 0 ||
			this.pendingCommits.length > 0
		) {
			this.scheduleFlush();
		}
	}

	private invalidateFromCollect(collect: FlushCollect): void {
		const blockIds = blockIdsFromCommits(collect.commits);
		const last = collect.commits[collect.commits.length - 1];
		if (blockIds.length === 0) {
			return;
		}
		this.geometry?.invalidateBlocks(blockIds, last?.commitId);
		this.onInvalidate?.(blockIds, last?.commitId ?? 0);
	}

	/** Last step of the read phase: contributor requests become a paint plan (OV1). */
	private readOverlays(collect: FlushCollect): void {
		this.overlayPainter?.read({ commits: collect.commits });
	}

	/** Last step of the write phase, after the projector (OV1). */
	private paintOverlays(ranWrites: boolean): void {
		const painter = this.overlayPainter;
		if (!painter) {
			return;
		}
		this.paints += 1;
		painter.paint({ ranWrites });
	}

	private drain(jobs: ScheduledJob[]): void {
		for (const job of jobs) {
			job();
		}
	}
}

function blockIdsFromCommits(commits: readonly CommitEvent[]): string[] {
	const ids = new Set<string>();
	for (const event of commits) {
		for (const id of blockIdsFromSummary(event.summary)) {
			ids.add(id);
		}
	}
	return [...ids];
}

function blockIdsFromSummary(summary: ChangeSummary): string[] {
	const ids: string[] = [];
	for (const text of summary.blockText) {
		ids.push(text.blockId);
	}
	for (const change of summary.structural) {
		ids.push(...blockIdsFromStructural(change));
	}
	return ids;
}

function blockIdsFromStructural(change: StructuralChange): readonly string[] {
	switch (change.type) {
		case "block-inserted":
		case "block-removed":
		case "block-moved":
		case "block-props-changed":
		case "table-changed":
			return [change.blockId];
		case "block-split":
			return [change.blockId, change.newBlockId];
		case "blocks-merged":
			return [change.targetBlockId, change.sourceBlockId];
		case "apps-changed":
		case "metadata-changed":
			return [];
		default: {
			const _exhaustive: never = change;
			return _exhaustive;
		}
	}
}
