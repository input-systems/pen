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

const HEX_COLOR_PATTERN =
	/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNCTION_COLOR_PATTERN = /^(?:rgb|rgba|hsl|hsla)\([^;{}]+\)$/;
const CSS_VARIABLE_COLOR_PATTERN = /^var\(--[A-Za-z0-9_-]+\)$/;
const NAMED_COLOR_PATTERN = /^[A-Za-z]+$/;
const CSS_COLOR_KEYWORDS = new Set([
	"transparent",
	"currentColor",
	"inherit",
	"initial",
	"unset",
	"revert",
	"revert-layer",
]);

export function normalizeMultiplayerColor(
	color: string | undefined,
	fallbackColor: string,
): string {
	const trimmedColor = color?.trim();
	if (!trimmedColor) {
		return fallbackColor;
	}

	if (
		HEX_COLOR_PATTERN.test(trimmedColor) ||
		FUNCTION_COLOR_PATTERN.test(trimmedColor) ||
		CSS_VARIABLE_COLOR_PATTERN.test(trimmedColor) ||
		NAMED_COLOR_PATTERN.test(trimmedColor) ||
		CSS_COLOR_KEYWORDS.has(trimmedColor)
	) {
		return trimmedColor;
	}

	return fallbackColor;
}
