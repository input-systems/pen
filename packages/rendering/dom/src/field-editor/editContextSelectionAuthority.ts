export type EditContextSelection = {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
};

export type EditContextRange = {
	start: number;
	end: number;
};

export type DirectionalSelectionOffsets = {
	anchor: number;
	focus: number;
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

export function resolveEditContextTextUpdateRange(input: {
	blockId: string;
	updateRangeStart: number;
	updateRangeEnd: number;
	text: string;
	selectionStart?: number;
	selectionEnd?: number;
	isLogicallyEmpty: boolean;
	editorSelectionRange: EditContextRange | null;
	authoritativeTextInputSelection: EditContextSelection | null;
	editorCaret: number | null;
}): TextUpdateRangeResolution {
	const isCollapsedInsert =
		input.text.length > 0 &&
		input.updateRangeStart === input.updateRangeEnd;
	const authoritativeInputCaret = collapsedSelectionOffset(
		input.authoritativeTextInputSelection,
		input.blockId,
	);
	const trustedCaret =
		authoritativeInputCaret ??
		(input.isLogicallyEmpty ? 0 : input.editorCaret);
	const shouldUseTrustedCaret =
		isCollapsedInsert &&
		trustedCaret != null &&
		trustedCaret !== input.updateRangeStart;
	const editorSelectionRange = input.editorSelectionRange;
	const shouldUseEditorSelectionRange =
		editorSelectionRange != null &&
		input.updateRangeStart === input.updateRangeEnd &&
		(input.updateRangeStart !== editorSelectionRange.start ||
			input.updateRangeEnd !== editorSelectionRange.end);
	const shouldClampEmptyRange =
		input.isLogicallyEmpty && authoritativeInputCaret == null;
	const selectedEditorRange = shouldUseEditorSelectionRange
		? editorSelectionRange
		: null;
	const rangeStart = selectedEditorRange
		? selectedEditorRange.start
		: shouldClampEmptyRange
			? 0
			: shouldUseTrustedCaret
				? trustedCaret
				: input.updateRangeStart;
	const rangeEnd = selectedEditorRange
		? selectedEditorRange.end
		: shouldClampEmptyRange
			? 0
			: shouldUseTrustedCaret
				? trustedCaret
				: input.updateRangeEnd;
	const hasCollapsedEventSelection =
		typeof input.selectionStart !== "number" ||
		typeof input.selectionEnd !== "number" ||
		input.selectionStart === input.selectionEnd;
	const nextSelectionOffset =
		input.text.length > 0 && hasCollapsedEventSelection
			? rangeStart + input.text.length
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
		range: {
			start: rangeStart,
			end: rangeEnd,
		},
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

export function resolveEditContextKeyDownRange(input: {
	blockId: string | null;
	isTextEditingKey: boolean;
	liveDomOffsets: DirectionalSelectionOffsets | null;
	editContextRange: EditContextRange;
	editorSelectionRange: EditContextRange | null;
	authoritativeTextInputSelection: EditContextSelection | null;
	collapsedEditorSelectionRange: EditContextRange | null;
	synchronizedEditContextRange: EditContextRange | null;
}): KeyDownRangeResolution {
	if (!input.blockId) {
		return {
			range: input.liveDomOffsets
				? directionalSelectionToRange(input.liveDomOffsets)
				: input.editContextRange,
			shouldSyncEditContextSelection: false,
		};
	}

	const trustedKeyRange = resolveTrustedKeyDownRange(input);
	if (trustedKeyRange) {
		return {
			range: trustedKeyRange,
			shouldSyncEditContextSelection: true,
		};
	}

	if (
		input.editorSelectionRange &&
		(!input.liveDomOffsets ||
			(input.liveDomOffsets.start === input.liveDomOffsets.end &&
				!rangesEqual(input.liveDomOffsets, input.editorSelectionRange)))
	) {
		return {
			range: input.editorSelectionRange,
			shouldSyncEditContextSelection: true,
		};
	}

	if (
		input.liveDomOffsets &&
		shouldUseLiveDomSelection(
			input.liveDomOffsets,
			input.authoritativeTextInputSelection,
		)
	) {
		return {
			range: directionalSelectionToRange(input.liveDomOffsets),
			shouldSyncEditContextSelection: true,
		};
	}

	return {
		range: input.liveDomOffsets
			? directionalSelectionToRange(input.liveDomOffsets)
			: input.editContextRange,
		shouldSyncEditContextSelection: false,
	};
}

function collapsedSelectionOffset(
	selection: EditContextSelection | null,
	blockId: string,
): number | null {
	if (
		selection?.blockId !== blockId ||
		selection.anchorOffset !== selection.focusOffset
	) {
		return null;
	}
	return selection.focusOffset;
}

function selectionToRange(
	selection: EditContextSelection,
): EditContextRange {
	return {
		start: Math.min(selection.anchorOffset, selection.focusOffset),
		end: Math.max(selection.anchorOffset, selection.focusOffset),
	};
}

function directionalSelectionToRange(
	selection: DirectionalSelectionOffsets,
): EditContextRange {
	return {
		start: selection.start,
		end: selection.end,
	};
}

export function rangesEqual(
	left: EditContextRange,
	right: EditContextRange,
): boolean {
	return left.start === right.start && left.end === right.end;
}

function resolveTrustedKeyDownRange(input: {
	isTextEditingKey: boolean;
	editorSelectionRange: EditContextRange | null;
	authoritativeTextInputSelection: EditContextSelection | null;
	collapsedEditorSelectionRange: EditContextRange | null;
	synchronizedEditContextRange: EditContextRange | null;
}): EditContextRange | null {
	if (!input.isTextEditingKey) {
		return null;
	}

	if (input.editorSelectionRange) {
		return input.editorSelectionRange;
	}

	if (input.authoritativeTextInputSelection) {
		return selectionToRange(input.authoritativeTextInputSelection);
	}

	if (input.collapsedEditorSelectionRange) {
		return input.collapsedEditorSelectionRange;
	}

	if (input.synchronizedEditContextRange) {
		return input.synchronizedEditContextRange;
	}

	return null;
}

function shouldUseLiveDomSelection(
	liveDomOffsets: DirectionalSelectionOffsets,
	authoritativeSelection: EditContextSelection | null,
): boolean {
	return !(
		authoritativeSelection &&
		liveDomOffsets.anchor === liveDomOffsets.focus &&
		(liveDomOffsets.anchor !== authoritativeSelection.anchorOffset ||
			liveDomOffsets.focus !== authoritativeSelection.focusOffset)
	);
}
