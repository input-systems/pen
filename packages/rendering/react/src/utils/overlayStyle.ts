import type React from "react";

/** A React inline style that may also carry CSS custom properties. */
export type OverlayReactStyle = React.CSSProperties & Record<string, string | number>;

/**
 * Turn pen-dom's overlay inline style (CSS property names) into a React
 * style object: standard properties become camelCase, custom properties
 * (`--pen-…`) keep their names. `omit` drops properties by CSS name.
 */
export function toOverlayReactStyle(
	style: Readonly<Record<string, string>>,
	omit: readonly string[] = [],
): OverlayReactStyle {
	const result: Record<string, string> = {};
	for (const [property, value] of Object.entries(style)) {
		if (omit.includes(property)) {
			continue;
		}
		const key = property.startsWith("--")
			? property
			: property.replace(/-([a-z])/g, (_match, letter: string) =>
					letter.toUpperCase(),
				);
		result[key] = value;
	}
	return result as OverlayReactStyle;
}
