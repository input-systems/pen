import { describe, expect, it } from "vitest";
import {
	assignMultiplayerColor,
	MULTIPLAYER_COLORS,
	normalizeMultiplayerColor,
} from "../presence/colorAssignment";

describe("assignMultiplayerColor", () => {
	it("returns the same color for the same user id", () => {
		expect(assignMultiplayerColor("user-1")).toBe(
			assignMultiplayerColor("user-1"),
		);
	});

	it("returns a color from the exported palette", () => {
		expect(MULTIPLAYER_COLORS).toContain(assignMultiplayerColor("someone"));
		expect(MULTIPLAYER_COLORS).toContain(assignMultiplayerColor(""));
	});

	it("every palette entry is a hex color normalize accepts", () => {
		for (const color of MULTIPLAYER_COLORS) {
			expect(normalizeMultiplayerColor(color, "#000000")).toBe(color);
		}
	});

	it("AX8: every palette entry holds 4.5:1 against the white caret label", () => {
		const luminance = (hex: string) => {
			const channels = [1, 3, 5].map((start) => {
				const value =
					Number.parseInt(hex.slice(start, start + 2), 16) / 255;
				return value <= 0.03928
					? value / 12.92
					: ((value + 0.055) / 1.055) ** 2.4;
			});
			return (
				0.2126 * channels[0]! +
				0.7152 * channels[1]! +
				0.0722 * channels[2]!
			);
		};
		const belowAa = MULTIPLAYER_COLORS.filter(
			(color) => 1.05 / (luminance(color) + 0.05) < 4.5,
		);
		expect(belowAa).toEqual([]);
	});
});

describe("normalizeMultiplayerColor", () => {
	it("preserves valid colors", () => {
		expect(normalizeMultiplayerColor("#abc123", "#000000")).toBe("#abc123");
		expect(normalizeMultiplayerColor("rgb(1 2 3)", "#000000")).toBe(
			"rgb(1 2 3)",
		);
		expect(
			normalizeMultiplayerColor("hsl(210deg 50% 40%)", "#000000"),
		).toBe("hsl(210deg 50% 40%)");
		expect(normalizeMultiplayerColor("RebeccaPurple", "#000000")).toBe(
			"RebeccaPurple",
		);
	});

	it.each([
		"rgb(0,0,0) url(https://evil/x.png)",
		"image-set(url(https://evil/x.png) 1x)",
		"var(--brand-color)",
		"var(--x, url(https://evil/x.png))",
		"expression(alert(1))",
		"red}body{background:url(https://evil/x.png)",
		"rgb(0,0,0)/**/url(https://evil/x.png)",
		"\\75 rl(https://evil/x.png)",
		"notacolor",
	])("COL2: falls back for the hostile colour %j", (color) => {
		expect(normalizeMultiplayerColor(color, "#000000")).toBe("#000000");
	});

	it("falls back for invalid colors", () => {
		expect(
			normalizeMultiplayerColor("red;position:absolute", "#000000"),
		).toBe("#000000");
		expect(normalizeMultiplayerColor(undefined, "#000000")).toBe("#000000");
	});
});
