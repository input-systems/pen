import { describe, expect, it } from "vitest";
import { isSafeCssColor } from "../security/cssColor";

// COL2 / SEC: a peer colour is untrusted awareness input that lands in a CSS
// custom property. Only plain colour syntax may pass; anything that can
// fetch, reference, or break out of the declaration is rejected.
const HOSTILE_COLORS = [
	"rgb(0,0,0) url(https://evil/x.png)",
	"rgb(0 0 0) url(https://evil/x.png)",
	"url(https://evil/x.png)",
	"rgb(url(https://evil/x.png))",
	"image-set(url(https://evil/x.png) 1x)",
	"rgb(0,0,0) image-set('https://evil/x.png' 1x)",
	"var(--x)",
	"var(--x, url(https://evil/x.png))",
	"rgb(var(--x))",
	"expression(alert(1))",
	"rgb(0,0,0);background:url(https://evil/x.png)",
	"red;position:absolute",
	"red}body{background:url(https://evil/x.png)",
	"rgb(0,0,0)/**/url(https://evil/x.png)",
	"rgb(0 0 0 /* */)",
	"\\75 rl(https://evil/x.png)",
	"rgb(\\30 ,0,0)",
	"r\\67 b(0,0,0)",
	"rgb((0),0,0)",
	"rgb(0,0,0))",
	"rgb(0,0,0) rgb(0,0,0)",
	"rgb(calc(1),0,0)",
	"rgb(0,0,0)\nurl(https://evil/x.png)",
	"#fff url(https://evil/x.png)",
	"red url(https://evil/x.png)",
	"notacolor",
	"inherit",
	"",
	`rgb(${"1,".repeat(64)}1)`,
];

describe("isSafeCssColor (COL2)", () => {
	it.each(HOSTILE_COLORS)("rejects hostile colour %j", (value) => {
		expect(isSafeCssColor(value)).toBe(false);
	});

	it.each([
		"#abc",
		"#abcd",
		"#a1b2c3",
		"#A1B2C3D4",
		"rgb(1, 2, 3)",
		"rgb(1 2 3)",
		"rgba(1, 2, 3, 0.5)",
		"rgb(1 2 3 / 50%)",
		"hsl(210 50% 40%)",
		"hsl(210deg 50% 40%)",
		"hsla(-30, 50%, 40%, .5)",
		"red",
		"RebeccaPurple",
		"transparent",
		"currentColor",
	])("accepts plain colour %j", (value) => {
		expect(isSafeCssColor(value)).toBe(true);
	});

	it("rejects non-strings", () => {
		expect(isSafeCssColor(undefined)).toBe(false);
		expect(isSafeCssColor(42)).toBe(false);
		expect(isSafeCssColor({ toString: () => "red" })).toBe(false);
	});
});
