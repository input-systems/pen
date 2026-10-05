export type EditContextSelection = {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
};

export type EditContextRange = {
	start: number;
	end: number;
};

export type KeyDownRangeResolution = {
	range: EditContextRange;
	shouldSyncEditContextSelection: boolean;
};

export type TextUpdateRangeResolution = {
	range: EditContextRange;
	selection: EditContextSelection | null;
};

/**
 * FE9: the range a `textupdate` replaces. `authority` is the record's
 * selection in the field and `trustedCaret` the last collapsed caret a
 * `textupdate` resolved there; the event's own range is the buffer's.
 *
 * - A collapsed update while the authority holds a range replaces that range.
 * - An empty field with no trusted caret inserts at 0.
 * - A collapsed insert away from the trusted caret — else the authority's
 *   caret, 0 in an empty field — goes to that caret.
 * - Otherwise the buffer's range stands.
 */
export function resolveEditContextTextUpdateRange(input: {
	blockId: string;
	updateRangeStart: number;
	updateRangeEnd: number;
	text: string;
	selectionStart?: number;
	selectionEnd?: number;
	isLogicallyEmpty: boolean;
	authority: EditContextRange | null;
	trustedCaret: number | null;
}): TextUpdateRangeResolution {
	const { authority, trustedCaret } = input;
	const isCollapsedUpdate = input.updateRangeStart === input.updateRangeEnd;
	const authorityCaret =
		authority && authority.start === authority.end ? authority.start : null;
	const caret = trustedCaret ?? (input.isLogicallyEmpty ? 0 : authorityCaret);
	const range: EditContextRange =
		authority && authorityCaret === null && isCollapsedUpdate
			? authority
			: input.isLogicallyEmpty && trustedCaret === null
				? { start: 0, end: 0 }
				: input.text.length > 0 &&
					  isCollapsedUpdate &&
					  caret !== null &&
					  caret !== input.updateRangeStart
					? { start: caret, end: caret }
					: {
							start: input.updateRangeStart,
							end: input.updateRangeEnd,
						};
	const hasCollapsedEventSelection =
		typeof input.selectionStart !== "number" ||
		typeof input.selectionEnd !== "number" ||
		input.selectionStart === input.selectionEnd;
	const nextSelectionOffset =
		input.text.length > 0 && hasCollapsedEventSelection
			? range.start + input.text.length
			: null;
	const anchorOffset =
		nextSelectionOffset ??
		(typeof input.selectionStart === "number"
			? input.selectionStart
			: null);
	const focusOffset =
		nextSelectionOffset ??
		(typeof input.selectionEnd === "number" ? input.selectionEnd : null);

	return {
		range,
		selection:
			anchorOffset != null && focusOffset != null
				? {
						blockId: input.blockId,
						anchorOffset,
						focusOffset,
					}
				: null,
	};
}

/**
 * W3.R5, FE9: the range a key edits — the authority after the reader sync,
 * else the trusted typing caret, else the buffer's selection. A
 * text-editing key at a collapsed authority takes the trusted caret over
 * it. The buffer takes the range unless the range is the buffer's own or a
 * collapsed authority the trusted caret disagrees with.
 */
export function resolveEditContextKeyDownRange(input: {
	authority: EditContextRange | null;
	trustedCaret: number | null;
	isTextEditingKey: boolean;
	bufferRange: EditContextRange;
}): KeyDownRangeResolution {
	const { authority, trustedCaret } = input;
	const authorityCollapsed =
		authority === null || authority.start === authority.end;
	if (trustedCaret !== null && input.isTextEditingKey && authorityCollapsed) {
		return {
			range: { start: trustedCaret, end: trustedCaret },
			shouldSyncEditContextSelection: true,
		};
	}
	if (!authority) {
		return {
			range: input.bufferRange,
			shouldSyncEditContextSelection: false,
		};
	}
	return {
		range: authority,
		shouldSyncEditContextSelection:
			trustedCaret === null ||
			!authorityCollapsed ||
			authority.start === trustedCaret,
	};
}
