import { LOCAL_PRESENCE_MIN_INTERVAL_MS } from "./constants";

/**
 * Coalesces local presence writes.
 *
 * Presence is last-value-wins, and COL2 caps how many updates a peer accepts
 * per second. Publishing once per selection change outruns that budget as soon
 * as someone types quickly or drags a selection, and a peer that rejects an
 * update keeps the sender's *previous* caret — so the caret appears to freeze
 * and then jump. Writing at most once per interval, always with the latest
 * state, keeps a sender inside what every peer will accept.
 */
export class LocalPresenceWriter {
	private readonly publish: () => void;
	private readonly minIntervalMs: number;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private hasPendingWrite = false;

	constructor(options: { publish: () => void; minIntervalMs?: number }) {
		this.publish = options.publish;
		this.minIntervalMs =
			options.minIntervalMs ?? LOCAL_PRESENCE_MIN_INTERVAL_MS;
	}

	/**
	 * Publishes straight away when nothing was written this interval, so a
	 * caret still moves the moment it moves. Anything after that folds into a
	 * single trailing write.
	 */
	request(): void {
		if (this.timer !== null) {
			this.hasPendingWrite = true;
			return;
		}

		this.publish();
		this.openInterval();
	}

	/** Publishes at the end of the interval, so a selection change within it wins. */
	requestTrailing(): void {
		this.hasPendingWrite = true;
		if (this.timer === null) {
			this.openInterval();
		}
	}

	/** Drops a pending write, for state the caller is about to replace. */
	cancel(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.hasPendingWrite = false;
	}

	private openInterval(): void {
		this.timer = setTimeout(() => {
			this.timer = null;
			if (!this.hasPendingWrite) {
				return;
			}
			this.hasPendingWrite = false;
			this.publish();
			this.openInterval();
		}, this.minIntervalMs);
	}
}
