import { foldAndNormalize } from "@input/pen-core";

/**
 * Whether a keydown matches a `+`-joined shortcut such as `mod+shift+k`.
 * `mod` is Meta on macOS and Ctrl elsewhere; every modifier must match
 * exactly.
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
	const parts = foldAndNormalize(shortcut, "en")
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	const key = parts[parts.length - 1];
	const expectsMeta = parts.includes("mod")
		? navigator.platform.toLowerCase().includes("mac")
		: parts.includes("meta") || parts.includes("cmd");
	const expectsCtrl = parts.includes("mod")
		? !navigator.platform.toLowerCase().includes("mac")
		: parts.includes("ctrl");
	const expectsShift = parts.includes("shift");
	const expectsAlt = parts.includes("alt") || parts.includes("option");
	return (
		event.key.toLowerCase() === key &&
		event.metaKey === expectsMeta &&
		event.ctrlKey === expectsCtrl &&
		event.shiftKey === expectsShift &&
		event.altKey === expectsAlt
	);
}
