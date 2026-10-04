import { isSafeCssColor } from "@input/pen-core";

/**
 * Default peer colors. The caret label paints white text on the peer color,
 * so every entry holds at least 4.5:1 against white (WCAG 1.4.3, AX8).
 */
export const MULTIPLAYER_COLORS = [
	"#1d4ed8",
	"#b91c1c",
	"#15803d",
	"#a16207",
	"#7e22ce",
	"#0e7490",
	"#be123c",
	"#4d7c0f",
	"#6d28d9",
	"#047857",
	"#b45309",
	"#4338ca",
] as const;

export function assignMultiplayerColor(userId: string): string {
	let hash = 0;

	for (let index = 0; index < userId.length; index += 1) {
		hash = ((hash << 5) - hash + userId.charCodeAt(index)) | 0;
	}

	return MULTIPLAYER_COLORS[Math.abs(hash) % MULTIPLAYER_COLORS.length];
}

/**
 * Returns `color` when it is a plain CSS colour (COL2: hex, a named colour,
 * or an `rgb`/`hsl` function of numbers), else `fallbackColor`. A peer colour
 * reaches a CSS custom property on every viewer, so anything that could
 * fetch or reference (`url(`, `image-set(`, `var(`) is rejected.
 */
export function normalizeMultiplayerColor(
	color: string | undefined,
	fallbackColor: string,
): string {
	const trimmedColor = color?.trim();
	return isSafeCssColor(trimmedColor) ? trimmedColor : fallbackColor;
}
