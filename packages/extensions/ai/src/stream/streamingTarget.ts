import type {
	CommitEvent,
	Editor,
	GenerationZone,
	OpOrigin,
	Point,
	TextStreamWriter,
	Unsubscribe,
} from "@input/pen-types";

export interface StreamingTarget {
	readonly generationZone: GenerationZone | null;
	beginStreaming(zoneId: string, blockId: string, origin?: OpOrigin): void;
	appendDelta(delta: string): void;
	endStreaming(status: "complete" | "cancelled" | "error"): void;
	/** The writer the current stream appends through, while one is open. */
	readonly activeWriter: TextStreamWriter | null;
}

const DEFAULT_STREAM_FLUSH_INTERVAL_MS = 50;

function createPlaceholderRange(blockId: string) {
	return {
		start: { blockId, offset: 0 },
		end: { blockId, offset: 0 },
		get isMultiBlock() {
			return false;
		},
		get blockRange() {
			return [blockId];
		},
		contains(point: Point) {
			return point.blockId === blockId && point.offset === 0;
		},
		overlaps(other: { start: Point; end: Point }) {
			return (
				other.start.blockId === blockId || other.end.blockId === blockId
			);
		},
		equals(other: { start: Point; end: Point }) {
			return (
				other.start.blockId === blockId &&
				other.start.offset === 0 &&
				other.end.blockId === blockId &&
				other.end.offset === 0
			);
		},
		toTextSelection() {
			return {
				type: "text" as const,
				anchor: { blockId, offset: 0 },
				focus: { blockId, offset: 0 },
			};
		},
	};
}

export class StreamingTargetImpl implements StreamingTarget {
	private readonly _editor: Editor;
	private readonly _flushIntervalMs: number;
	private _writer: TextStreamWriter | null = null;
	private _zone: GenerationZone | null = null;
	private _unsubscribeCommit: Unsubscribe | null = null;

	constructor(
		editor: Editor,
		flushIntervalMs = DEFAULT_STREAM_FLUSH_INTERVAL_MS,
	) {
		this._editor = editor;
		this._flushIntervalMs = flushIntervalMs;
	}

	get generationZone(): GenerationZone | null {
		return this._zone;
	}

	beginStreaming(zoneId: string, blockId: string, origin?: OpOrigin): void {
		this._closeWriter();

		this._zone = {
			id: zoneId,
			blockId,
			range: createPlaceholderRange(blockId),
			status: "streaming",
		};

		this._writer = this._editor.openTextStream(
			{ blockId },
			{
				origin: origin ?? { type: "ai" },
				flushIntervalMs: this._flushIntervalMs,
			},
		);

		this._unsubscribeCommit = this._editor.on(
			"commit",
			(event: CommitEvent) => {
				if (event.source !== "stream" || !this._zone) {
					return;
				}
				this._publishAwareness(this._zone.blockId);
			},
		);
	}

	appendDelta(delta: string): void {
		this._writer?.append(delta);
	}

	get activeWriter(): TextStreamWriter | null {
		return this._writer;
	}

	endStreaming(status: "complete" | "cancelled" | "error"): void {
		this._closeWriter();
		if (this._zone) {
			const zoneStatus = status === "cancelled" ? "error" : status;
			this._zone = { ...this._zone, status: zoneStatus };
		}
		this._clearAwareness();
		this._zone = null;
	}

	private _closeWriter(): void {
		this._writer?.close();
		this._writer = null;
		this._unsubscribeCommit?.();
		this._unsubscribeCommit = null;
	}

	/**
	 * Tell peers a run is writing into this block. The zone id stays local:
	 * the receiver keys the presence by client and block, and every field on
	 * the wire is one more untrusted string it has to bound (COL2).
	 *
	 * The payload is fixed for the zone's life, so this only writes when it
	 * changes. Republishing it on each stream commit would spend a peer's
	 * whole `MAX_PRESENCE_UPDATES_PER_SECOND` budget re-sending one block id,
	 * and every caret in the room would freeze behind the rate limiter.
	 */
	private _publishAwareness(blockId: string): void {
		const awareness = this._editor.internals.awareness;
		if (!awareness) {
			return;
		}
		const local = awareness.getLocalState() ?? {};
		const published = local.streaming as { blockId?: string } | undefined;
		if (published?.blockId === blockId) {
			return;
		}
		awareness.setLocalState({
			...local,
			streaming: { blockId },
		});
	}

	private _clearAwareness(): void {
		const awareness = this._editor.internals.awareness;
		if (!awareness) {
			return;
		}
		const local = awareness.getLocalState() ?? {};
		const { streaming: _omit, ...rest } = local as Record<string, unknown>;
		awareness.setLocalState(rest);
	}
}
