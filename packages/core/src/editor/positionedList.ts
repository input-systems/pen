/** Stale lookups after an edit before the positions after it are re-indexed. */
const STALE_READS_BEFORE_REINDEX = 32;

/**
 * A list of unique ids with their positions, kept proportional to edits
 * (SCALE2). A splice re-indexes nothing: positions before the first edited
 * index stay exact, and a lookup past it scans the array from there until
 * enough lookups have paid for re-indexing the tail. An edit of one entry in
 * a list of M costs O(M) native array moves, never O(M) map writes.
 */
export class PositionedList {
	private readonly _ids: string[];
	private readonly _positions = new Map<string, number>();
	/** Positions below this index are exact. */
	private _validBelow: number;
	private _staleReads = 0;

	private constructor(ids: string[]) {
		this._ids = ids;
		for (let at = 0; at < ids.length; at += 1) {
			this._positions.set(ids[at]!, at);
		}
		this._validBelow = ids.length;
	}

	/** Takes ownership of `ids`; null when it lists an id twice. */
	static of(ids: string[]): PositionedList | null {
		const list = new PositionedList(ids);
		return list._positions.size === ids.length ? list : null;
	}

	get ids(): readonly string[] {
		return this._ids;
	}

	get length(): number {
		return this._ids.length;
	}

	has(id: string): boolean {
		return this._positions.has(id);
	}

	indexOf(id: string): number {
		const at = this._positions.get(id);
		if (at === undefined) return -1;
		if (at < this._validBelow) return at;
		this._staleReads += 1;
		if (this._staleReads > STALE_READS_BEFORE_REINDEX) {
			this._reindexTail();
			return this._positions.get(id) ?? -1;
		}
		return this._ids.indexOf(id, this._validBelow);
	}

	/**
	 * Removes `deleteCount` ids at `at` and inserts `inserted` there. Returns
	 * the removed ids, or null, changing nothing, when the edit runs past the
	 * list or would list an id twice.
	 */
	splice(
		at: number,
		deleteCount: number,
		inserted: readonly string[] = [],
	): string[] | null {
		if (at < 0 || at + deleteCount > this._ids.length) return null;
		const removing = new Set<string>();
		for (let k = 0; k < deleteCount; k += 1) removing.add(this._ids[at + k]!);
		const adding = new Set<string>();
		for (const id of inserted) {
			if (adding.has(id) || (this._positions.has(id) && !removing.has(id))) {
				return null;
			}
			adding.add(id);
		}
		const removed = this._ids.splice(at, deleteCount, ...inserted);
		for (const id of removed) this._positions.delete(id);
		for (let k = 0; k < inserted.length; k += 1) {
			this._positions.set(inserted[k]!, at + k);
		}
		if (deleteCount > 0 || inserted.length > 0) {
			this._validBelow = Math.min(this._validBelow, at);
		}
		return removed;
	}

	private _reindexTail(): void {
		for (let at = this._validBelow; at < this._ids.length; at += 1) {
			this._positions.set(this._ids[at]!, at);
		}
		this._validBelow = this._ids.length;
		this._staleReads = 0;
	}
}
