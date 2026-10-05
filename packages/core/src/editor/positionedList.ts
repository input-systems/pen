/** Splices held in the edit log before the positions after them are re-indexed. */
const EDITS_BEFORE_REINDEX = 128;

/** One splice: `removed` ids left at `at` and `inserted` ids took their place. */
interface Edit {
	readonly at: number;
	readonly removed: number;
	readonly inserted: number;
}

/**
 * A list of unique ids with their positions, kept proportional to edits
 * (SCALE2). A splice re-indexes nothing: positions before the first edited
 * index stay exact, and a lookup past it replays the splices made since its
 * position was stored, so it costs O(splices), not O(list). After enough
 * splices the tail is re-indexed once, which the splices it absorbs pay for.
 * An edit of one entry in a list of M costs O(M) native array moves and
 * O(M / 128) amortized map writes.
 */
export class PositionedList {
	private readonly _ids: string[];
	/** Each id's position when it was last stored: exact below `_validBelow`. */
	private readonly _positions = new Map<string, number>();
	/** Positions below this index are exact. */
	private _validBelow: number;
	/** Splices since the positions at or past `_validBelow` were last exact. */
	private _edits: Edit[] = [];
	/** For an id placed since then: how many logged splices its position already reflects. */
	private readonly _placedAfter = new Map<string, number>();

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
		let at = this._positions.get(id);
		if (at === undefined) return -1;
		if (at < this._validBelow) return at;
		for (let k = this._placedAfter.get(id) ?? 0; k < this._edits.length; k += 1) {
			const edit = this._edits[k]!;
			if (at >= edit.at + edit.removed) at += edit.inserted - edit.removed;
		}
		if (this._ids[at] === id) return at;
		// Unreachable while every edit goes through `splice`; stay exact anyway.
		this._reindexTail();
		return this._positions.get(id) ?? -1;
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
		if (deleteCount === 0 && inserted.length === 0) return removed;
		for (const id of removed) {
			this._positions.delete(id);
			this._placedAfter.delete(id);
		}
		this._edits.push({ at, removed: deleteCount, inserted: inserted.length });
		for (let k = 0; k < inserted.length; k += 1) {
			this._positions.set(inserted[k]!, at + k);
			this._placedAfter.set(inserted[k]!, this._edits.length);
		}
		this._validBelow = Math.min(this._validBelow, at);
		if (this._edits.length >= EDITS_BEFORE_REINDEX) this._reindexTail();
		return removed;
	}

	private _reindexTail(): void {
		for (let at = this._validBelow; at < this._ids.length; at += 1) {
			this._positions.set(this._ids[at]!, at);
		}
		this._validBelow = this._ids.length;
		this._edits = [];
		this._placedAfter.clear();
	}
}
