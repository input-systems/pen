import { DATA_ATTRS } from "../utils/dataAttributes";

/**
 * Tokens the editor-chrome sheet reads. Theme by setting these on any
 * ancestor of the editor. Interpolated into the sheet so a renamed token
 * cannot leave the rules pointing at a name nothing documents.
 */
export const EDITOR_CHROME_CUSTOM_PROPERTIES = {
	focusRing: "--pen-focus-ring",
	placeholderColor: "--pen-placeholder-color",
} as const;

const EDITOR_CHROME_STYLE_ID = "pen-editor-chrome";

/**
 * Default editor-field chrome (HOST6).
 *
 * Shipped as text rather than a `.css` file on purpose: every published
 * package declares `sideEffects: false` (API7), which lets a bundler drop a
 * bare `import "…/editor.css"`, and a stylesheet that a bundler is entitled
 * to discard is not a contract. Text can be adopted deliberately —
 * `adoptEditorChrome()`, `adoptedStyleSheets`, a `<style>` element, or a
 * build step.
 *
 * Selectors and theme properties are interpolated from the vocabulary, so a
 * renamed attribute or token cannot leave the sheet pointing at a name
 * nothing emits.
 *
 * This is the golden-path sheet, not a required one. `PenEditor`,
 * `EditorRoot`, and `mountEditor` adopt it by default. Pass `chrome={false}`
 * for the unstyled HOST6 path: empty inline content stays zero-width, and
 * the UA focus ring is the AX5 signal.
 *
 * The root rule positions the root as the overlay layer's containing block
 * (OV2) at zero specificity, so any host rule wins. Without the sheet the
 * overlay sets the same value inline on a static root.
 */
export const PEN_EDITOR_CHROME_STYLESHEET = `
:where([${DATA_ATTRS.editorRoot}]) {
	position: relative;
}

[${DATA_ATTRS.inlineContent}] {
	display: block;
	width: 100%;
	min-height: 1em;
}

[${DATA_ATTRS.editorRoot}],
[${DATA_ATTRS.editorBlocksHost}],
[${DATA_ATTRS.editorBlock}],
[${DATA_ATTRS.inlineContent}] {
	outline: none;
}

[${DATA_ATTRS.inlineContent}]:focus-visible {
	outline: 2px solid var(${EDITOR_CHROME_CUSTOM_PROPERTIES.focusRing}, Highlight);
	outline-offset: 2px;
}

[${DATA_ATTRS.inlineContent}][${DATA_ATTRS.placeholderVisible}]::before {
	content: attr(data-placeholder);
	color: var(${EDITOR_CHROME_CUSTOM_PROPERTIES.placeholderColor}, GrayText);
	pointer-events: none;
	position: absolute;
	white-space: nowrap;
}
`;

/**
 * Adopt {@link PEN_EDITOR_CHROME_STYLESHEET} into `doc` once, refcounted.
 * Returns a release function; the last release removes the style element.
 *
 * HOST2: browser access stays inside this function, not at module scope.
 */
export function adoptEditorChrome(doc: Document): () => void {
	let styleElement = doc.getElementById(
		EDITOR_CHROME_STYLE_ID,
	) as HTMLStyleElement | null;

	if (!styleElement) {
		styleElement = doc.createElement("style");
		styleElement.id = EDITOR_CHROME_STYLE_ID;
		styleElement.textContent = PEN_EDITOR_CHROME_STYLESHEET;
		doc.head.appendChild(styleElement);
	}

	const nextRefCount = Number(styleElement.dataset.refCount ?? "0") + 1;
	styleElement.dataset.refCount = String(nextRefCount);

	return () => {
		const currentRefCount =
			Number(styleElement.dataset.refCount ?? "1") - 1;
		if (currentRefCount <= 0) {
			styleElement.remove();
			return;
		}
		styleElement.dataset.refCount = String(currentRefCount);
	};
}
