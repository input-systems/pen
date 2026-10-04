/**
 * A `keydown` an IME owns: the keystroke that starts or feeds a composition.
 * An {@link isUndecidedCompositionKeyDown} keystroke is not one.
 */
export function isCompositionKeyDown(event: KeyboardEvent): boolean {
	return (
		event.isComposing ||
		event.key === "Process" ||
		(event.keyCode === 229 && !isUndecidedCompositionKeyDown(event))
	);
}

/**
 * D20, FE2: `keyCode` 229 with `key` "Unidentified" is how an Android
 * virtual keyboard reports every key, Backspace and Enter included. Only the
 * `beforeinput` or `compositionstart` that follows says whether it composes.
 */
export function isUndecidedCompositionKeyDown(event: KeyboardEvent): boolean {
	return (
		!event.isComposing &&
		event.keyCode === 229 &&
		event.key === "Unidentified"
	);
}
