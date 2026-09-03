/** `Mod` is Cmd on Apple keyboards and Ctrl everywhere else. */
export const IS_APPLE = /Mac|iPhone|iPad/.test(navigator.userAgent);

const KEY_SYMBOLS: Record<string, string> = {
	mod: IS_APPLE ? "⌘" : "Ctrl",
	meta: "⌘",
	ctrl: "⌃",
	alt: IS_APPLE ? "⌥" : "Alt",
	shift: "⇧",
	enter: "↵",
	backspace: "⌫",
	escape: "⎋",
	tab: "⇥",
};

/**
 * Turns a key binding written the way Pen's keymap writes it into the glyphs a
 * keyboard shows: `Shift-Mod-z` → `⇧⌘Z`.
 *
 * Input's formatter is the same substitution table, minus the platform check —
 * it is a Mac-first app and always prints `⌘`.
 */
export function formatShortcut(shortcut: string): string {
	return shortcut
		.split(/[+-]/)
		.map((key) => KEY_SYMBOLS[key.toLowerCase()] ?? key.toUpperCase())
		.join("");
}

/** True when `event` is `Mod-<key>` with no other modifier held. */
export function isModShortcut(event: KeyboardEvent, key: string): boolean {
	if (event.key.toLowerCase() !== key || event.altKey || event.shiftKey) {
		return false;
	}
	return IS_APPLE
		? event.metaKey && !event.ctrlKey
		: event.ctrlKey && !event.metaKey;
}
