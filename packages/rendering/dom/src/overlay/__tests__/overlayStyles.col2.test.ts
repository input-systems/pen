import { describe, expect, it } from "vitest";
import { overlayItemStyle, overlayLabelStyle } from "../overlayStyles";
import type { OverlayPaintItem } from "../types";

const OPTIONS = { variant: "default", solidCaret: false } as const;

function remoteCaret(color: string | undefined): OverlayPaintItem {
	return {
		key: "peer",
		kind: "caret",
		role: "remote",
		contributor: "remote-carets",
		x: 0,
		y: 0,
		width: 0,
		height: 20,
		paint: "layer",
		epoch: 0,
		color,
	};
}

const HOSTILE = [
	"rgb(0,0,0) url(https://evil/x.png)",
	"image-set(url(https://evil/x.png) 1x)",
	"var(--x, url(https://evil/x.png))",
	"expression(alert(1))",
	"red;background:url(https://evil/x.png)",
	"red}body{background:url(https://evil/x.png)",
	"rgb(0,0,0)/**/url(https://evil/x.png)",
	"\\75 rl(https://evil/x.png)",
];

// COL2 defence in depth: the overlay re-validates the colour where it writes
// `--pen-peer-color`, and paints it through `background-color` so even a value
// that slipped through could not become a `background-image`.
describe("peer colour sink (COL2)", () => {
	it.each(HOSTILE)(
		"never writes the hostile colour %j to --pen-peer-color",
		(color) => {
			const caret = overlayItemStyle(remoteCaret(color), OPTIONS);
			const label = overlayLabelStyle({ x: 0, y: 0, color });
			expect(caret["--pen-peer-color"]).toBe("currentColor");
			expect(label["--pen-peer-color"]).toBe("currentColor");
		},
	);

	it("keeps a plain colour and paints it through background-color, not the shorthand", () => {
		const caret = overlayItemStyle(remoteCaret("#1d4ed8"), OPTIONS);
		const label = overlayLabelStyle({ x: 0, y: 0, color: "rgb(1 2 3)" });
		expect(caret["--pen-peer-color"]).toBe("#1d4ed8");
		expect(label["--pen-peer-color"]).toBe("rgb(1 2 3)");
		for (const style of [caret, label]) {
			expect(style.background).toBeUndefined();
			expect(style["background-color"]).toBe("var(--pen-peer-color)");
		}
	});
});
