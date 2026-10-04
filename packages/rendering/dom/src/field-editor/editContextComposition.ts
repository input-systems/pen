import type { FieldEditorDelta } from "./crdt";
import { rebaseOverDeferredDeltas } from "./contenteditableDomHelpers";
import type { TextDiffOp } from "./textDiff";

/**
 * C4: one IME composition on the EditContext backend, open from
 * `compositionstart` to its one commit or drop. The composed text stays out
 * of `Y.Text` while it is open: the EditContext buffer and the field DOM show
 * `baseText` with `replaced` swapped for `text`, and every `Y.Text` change in
 * the meantime is deferred (C2) and rebased over at the commit.
 *
 * Pure state: the backend owns the events, the DOM, and the apply.
 */
export type EditContextComposition = {
	readonly blockId: string;
	/** The field's logical text when the composition opened: the buffer's coordinates outside the composition. */
	readonly baseText: string;
	/** Where the composed text starts in the buffer; null until the first update. */
	readonly bufferStart: number | null;
	/** The range of `baseText` the composed text replaces; null until the first update. */
	readonly replaced: { readonly start: number; readonly end: number } | null;
	readonly text: string;
	/** `Y.Text` deltas since the composition opened, in order. */
	readonly deferred: ReadonlyArray<{ delta: FieldEditorDelta[] }>;
	/**
	 * What the field DOM shows: `baseText` untouched, the buffer with the
	 * composed text, or `Y.Text` after a composition edit it could not take.
	 */
	readonly field: "base" | "composed" | "model";
};

/** One edit to the field DOM, in its logical offsets. */
export type CompositionPaint = {
	offset: number;
	deleteLength: number;
	text: string;
};

export function openEditContextComposition(
	blockId: string,
	baseText: string,
): EditContextComposition {
	return {
		blockId,
		baseText,
		bufferStart: null,
		replaced: null,
		text: "",
		deferred: [],
		field: "base",
	};
}

/**
 * A composition opened around an update that already applied and was then
 * rewound (C1): `baseText` is the text after the rewind, and the composed
 * text sits at `start`, replacing nothing.
 */
export function openEditContextCompositionAround(
	blockId: string,
	baseText: string,
	start: number,
	text: string,
): EditContextComposition {
	return {
		blockId,
		baseText,
		bufferStart: start,
		replaced: { start, end: start },
		text,
		deferred: [],
		field: "composed",
	};
}

export function deferEditContextCompositionDelta(
	composition: EditContextComposition,
	delta: FieldEditorDelta[],
): EditContextComposition {
	return { ...composition, deferred: [...composition.deferred, { delta }] };
}

/**
 * Folds one composition `textupdate` — buffer range `[start, end)` replaced
 * by `text` — into the composition, and returns the edit that shows it in
 * the field. `firstRange` is the range the first update replaces in
 * `baseText`, when the caller resolved it differently from the buffer range
 * (FE9); later ranges are read against the composition in the buffer, and an
 * update that reaches past the composed text grows the replaced range.
 */
export function updateEditContextComposition(
	composition: EditContextComposition,
	update: { start: number; end: number; text: string },
	firstRange?: { start: number; end: number },
): { composition: EditContextComposition; paint: CompositionPaint } {
	const { start, end, text } = update;
	const previous = composition.replaced;
	const bufferStart = composition.bufferStart;
	if (previous === null || bufferStart === null) {
		const range = firstRange ?? { start, end };
		return {
			composition: {
				...composition,
				bufferStart: start,
				replaced: range,
				text,
			},
			paint: {
				offset: range.start,
				deleteLength: range.end - range.start,
				text,
			},
		};
	}
	const bufferEnd = bufferStart + composition.text.length;
	const from = Math.min(start, bufferStart);
	const to = Math.max(end, bufferEnd);
	const replaced = {
		start: Math.max(0, previous.start - (bufferStart - from)),
		end: Math.min(
			composition.baseText.length,
			previous.end + (to - bufferEnd),
		),
	};
	const covered =
		composition.baseText.slice(replaced.start, previous.start) +
		composition.text +
		composition.baseText.slice(previous.end, replaced.end);
	return {
		composition: {
			...composition,
			bufferStart: from,
			replaced,
			text: covered.slice(0, start - from) + text + covered.slice(end - from),
		},
		// The field shows the buffer with the composed text moved to
		// `previous.start`, so the update paints at that shift.
		paint: {
			offset: start - bufferStart + previous.start,
			deleteLength: end - start,
			text,
		},
	};
}

/**
 * The composition's one commit in `Y.Text` coordinates: its edit of
 * `baseText`, rebased over the deferred deltas with Yjs's placement (the
 * contenteditable C2 rebase), so a remote insert inside the replaced range
 * survives, and the caret after the composed text. Null when there is
 * nothing to commit.
 */
export function commitEditContextComposition(
	composition: EditContextComposition,
): { diff: TextDiffOp[]; caret: number } | null {
	const { replaced, text } = composition;
	if (!replaced || text.length === 0) {
		return null;
	}
	const ops: TextDiffOp[] = [];
	if (replaced.end > replaced.start) {
		ops.push({
			type: "delete",
			offset: replaced.start,
			length: replaced.end - replaced.start,
		});
	}
	ops.push({ type: "insert", offset: replaced.start, text });
	const rebased = rebaseOverDeferredDeltas(
		ops,
		composition.deferred,
		composition.baseText.length,
	);
	// With nothing deferred the caret ends the composed text where it went;
	// a rebased edit always holds the insert, so it always has a caret.
	return {
		diff: rebased.diff,
		caret: rebased.caret ?? replaced.start + text.length,
	};
}
