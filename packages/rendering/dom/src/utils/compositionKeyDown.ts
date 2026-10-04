/** A `keydown` an IME owns: the keystroke that starts or feeds a composition. */
export function isCompositionKeyDown(event: KeyboardEvent): boolean {
	return (
		event.isComposing || event.key === "Process" || event.keyCode === 229
	);
}
