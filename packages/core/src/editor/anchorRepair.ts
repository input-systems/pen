import type {
	Anchor,
	ChangeSummary,
	Editor,
	TextSplice,
} from "@input/pen-types";

import { peekPreCommitTarget, remintAnchor } from "./anchors";

/**
 * A pre-commit text range that a structural commit copied onto another block (AN14).
 */
export interface ContentMove {
	readonly fromBlockId: string;
	readonly fromRange: { readonly from: number; readonly to: number };
	readonly toBlockId: string;
	readonly toOffset: number;
}

function sitsInMovedRange(
	offset: number,
	assoc: Anchor["assoc"],
	range: ContentMove["fromRange"],
	sourceRemoved: boolean,
): boolean {
	if (offset > range.from && offset < range.to) {
		return true;
	}
	// An anchor on an edge stays with the text on its side of that edge, unless
	// the commit removed the source block and left nothing there to stay with.
	if (offset === range.from && (assoc === 1 || sourceRemoved)) {
		return true;
	}
	if (
		offset === range.to &&
		range.to > range.from &&
		(assoc === -1 || sourceRemoved)
	) {
		return true;
	}
	return false;
}

function structuralMoves(summary: ChangeSummary): ContentMove[] {
	const moves: ContentMove[] = [];
	for (const change of summary.structural) {
		if (change.type === "block-split") {
			moves.push({
				fromBlockId: change.blockId,
				fromRange: { from: change.offset, to: Number.MAX_SAFE_INTEGER },
				toBlockId: change.newBlockId,
				toOffset: 0,
			});
			continue;
		}
		if (change.type === "blocks-merged") {
			moves.push({
				fromBlockId: change.sourceBlockId,
				fromRange: { from: 0, to: Number.MAX_SAFE_INTEGER },
				toBlockId: change.targetBlockId,
				toOffset: change.joinOffset,
			});
		}
	}
	return moves;
}

function spliceDeletes(change: {
	blockId: string;
	splices: readonly TextSplice[];
}): Array<{ blockId: string; from: number; to: number }> {
	const deletes: Array<{ blockId: string; from: number; to: number }> = [];
	for (const splice of change.splices) {
		if (splice.to > splice.from && splice.insertLength === 0) {
			deletes.push({
				blockId: change.blockId,
				from: splice.from,
				to: splice.to,
			});
		}
	}
	return deletes;
}

function spliceInserts(change: {
	blockId: string;
	splices: readonly TextSplice[];
}): Array<{ blockId: string; from: number; length: number }> {
	const inserts: Array<{ blockId: string; from: number; length: number }> =
		[];
	for (const splice of change.splices) {
		if (splice.insertLength > 0 && splice.to === splice.from) {
			inserts.push({
				blockId: change.blockId,
				from: splice.from,
				length: splice.insertLength,
			});
		}
	}
	return inserts;
}

function remoteMoves(
	summary: ChangeSummary,
	taken: ReadonlySet<string>,
): ContentMove[] {
	const deletes: Array<{ blockId: string; from: number; to: number }> = [];
	const inserts: Array<{ blockId: string; from: number; length: number }> =
		[];
	for (const change of summary.blockText) {
		deletes.push(...spliceDeletes(change));
		inserts.push(...spliceInserts(change));
	}
	const used = new Set<number>();
	const moves: ContentMove[] = [];
	for (const del of deletes) {
		if (taken.has(del.blockId)) {
			continue;
		}
		const length = del.to - del.from;
		const matchIndex = inserts.findIndex(
			(insert, index) =>
				!used.has(index) &&
				insert.length === length &&
				insert.blockId !== del.blockId,
		);
		if (matchIndex < 0) {
			continue;
		}
		used.add(matchIndex);
		const insert = inserts[matchIndex]!;
		moves.push({
			fromBlockId: del.blockId,
			fromRange: { from: del.from, to: del.to },
			toBlockId: insert.blockId,
			toOffset: insert.from,
		});
	}
	return moves;
}

/**
 * Derive the copy-based content moves a structural commit performed (AN14).
 *
 * Local Pen commits expose `block-split` / `blocks-merged` on the summary.
 * Remote commits without those tags fall back to same-length delete/insert pairing.
 * `intent` is accepted for the AN14 signature; recipes live on the summary.
 */
export function deriveContentMoves(
	summary: ChangeSummary,
	_intent: string | undefined,
): readonly ContentMove[] {
	const fromStructural = structuralMoves(summary);
	const taken = new Set(fromStructural.map((move) => move.fromBlockId));
	return [...fromStructural, ...remoteMoves(summary, taken)];
}

/**
 * Re-mint into the destination when the pre-commit target sat in a moved range (AN14).
 *
 * The pre-commit target is the anchor's last observation before this commit, so
 * a resolve made after the commit landed does not feed the repair, and an anchor
 * that last resolved to `null` is not revived from an older position.
 * Returns the same object when no move applies. Remint keeps the original provenance.
 */
export function repairAnchor(
	editor: Editor,
	anchor: Anchor,
	moves: readonly ContentMove[],
): Anchor {
	if (moves.length === 0) {
		return anchor;
	}
	const prior = peekPreCommitTarget(editor.anchors, anchor);
	if (!prior) {
		return anchor;
	}
	for (const move of moves) {
		if (prior.blockId !== move.fromBlockId) {
			continue;
		}
		const sourceRemoved = editor.getBlock(move.fromBlockId) === null;
		if (
			!sitsInMovedRange(
				prior.offset,
				anchor.assoc,
				move.fromRange,
				sourceRemoved,
			)
		) {
			continue;
		}
		const destOffset = move.toOffset + (prior.offset - move.fromRange.from);
		const reminted = remintAnchor(
			editor.anchors,
			{
				blockId: move.toBlockId,
				offset: destOffset,
				...(prior.cell ? { cell: prior.cell } : {}),
			},
			anchor.assoc,
			anchor.provenance,
		);
		return reminted ?? anchor;
	}
	return anchor;
}
