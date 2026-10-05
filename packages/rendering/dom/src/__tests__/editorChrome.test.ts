// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DATA_ATTRS } from "../utils/dataAttributes";
import {
	adoptEditorChrome,
	EDITOR_CHROME_CUSTOM_PROPERTIES,
	PEN_EDITOR_CHROME_STYLESHEET,
} from "../styles/editorChrome";

const SOURCE = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "..", "styles", "editorChrome.ts"),
	"utf8",
);

describe("HOST6: editor chrome stylesheet", () => {
	afterEach(() => {
		document.getElementById("pen-editor-chrome")?.remove();
	});

	it("interpolates data attributes and theme tokens instead of restating them", () => {
		const literalSelectors = SOURCE.match(/\[data-pen-[a-z-]+\]/g) ?? [];
		expect(
			literalSelectors,
			"sheet selectors must interpolate DATA_ATTRS, not restate them",
		).toEqual([]);

		const bareProperties =
			SOURCE.match(/var\(--pen-(?:focus-ring|placeholder-color)/g) ?? [];
		expect(
			bareProperties,
			"sheet custom properties must interpolate EDITOR_CHROME_CUSTOM_PROPERTIES",
		).toEqual([]);

		expect(PEN_EDITOR_CHROME_STYLESHEET).toContain(
			`[${DATA_ATTRS.inlineContent}]`,
		);
		expect(PEN_EDITOR_CHROME_STYLESHEET).toContain(
			`[${DATA_ATTRS.placeholderVisible}]`,
		);
		expect(PEN_EDITOR_CHROME_STYLESHEET).toContain(
			EDITOR_CHROME_CUSTOM_PROPERTIES.focusRing,
		);
		expect(PEN_EDITOR_CHROME_STYLESHEET).toContain(
			EDITOR_CHROME_CUSTOM_PROPERTIES.placeholderColor,
		);
	});

	it("AX5: outline none ships with a :focus-visible ring", () => {
		expect(PEN_EDITOR_CHROME_STYLESHEET).toMatch(/outline:\s*none/);
		expect(PEN_EDITOR_CHROME_STYLESHEET).toMatch(/:focus-visible/);
		expect(PEN_EDITOR_CHROME_STYLESHEET).toMatch(
			/:focus-visible\s*\{[^}]*outline:\s*2px solid/,
		);
	});

	it("fills the empty inline field so a click lands", () => {
		expect(PEN_EDITOR_CHROME_STYLESHEET).toMatch(
			/display:\s*block/,
		);
		expect(PEN_EDITOR_CHROME_STYLESHEET).toMatch(/width:\s*100%/);
		expect(PEN_EDITOR_CHROME_STYLESHEET).toMatch(/min-height:\s*1em/);
	});

	it("OV2: positions the root at zero specificity so a host rule wins", () => {
		expect(PEN_EDITOR_CHROME_STYLESHEET).toMatch(
			/:where\(\[data-pen-editor-root\]\)\s*\{[^}]*position:\s*relative/,
		);
	});

	it("adoptEditorChrome injects once and removes on the last release", () => {
		const first = adoptEditorChrome(document);
		const second = adoptEditorChrome(document);
		const style = document.getElementById("pen-editor-chrome");
		expect(style).toBeInstanceOf(HTMLStyleElement);
		expect(style?.textContent).toBe(PEN_EDITOR_CHROME_STYLESHEET);
		expect(
			document.querySelectorAll("#pen-editor-chrome"),
		).toHaveLength(1);

		first();
		expect(document.getElementById("pen-editor-chrome")).not.toBeNull();
		second();
		expect(document.getElementById("pen-editor-chrome")).toBeNull();
	});
});
