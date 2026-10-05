import type { SchemaRegistry } from "@input/pen-types";
import { REVIEW_SURFACE_CLASSES } from "@input/pen-types";
import { urlPolicy, type UrlPolicy } from "../security/urlPolicy";
import { INLINE_DECORATION_ATTRIBUTE_KEY } from "../utils/inlineDecorations";

const TEXT_COLOR_CUSTOM_PROPERTY = "--pen-text-color";
const BACKGROUND_COLOR_CUSTOM_PROPERTY = "--pen-background-color";
const HIGHLIGHT_CUSTOM_PROPERTY = "--pen-highlight-color";

export function wrapWithMarks(
	node: Node,
	attributes: Record<string, unknown>,
	registry: SchemaRegistry,
	policy: UrlPolicy = urlPolicy,
): Node {
	// Marks are created in `node`'s document, the field's, which is an
	// iframe's when the host mounts the editor there.
	const doc = node.ownerDocument ?? document;
	let wrapped = node;
	const decorationAttributes = isDecorationAttributesValue(
		attributes[INLINE_DECORATION_ATTRIBUTE_KEY],
	)
		? attributes[INLINE_DECORATION_ATTRIBUTE_KEY]
		: null;

	const entries = Object.entries(attributes)
		.filter(([key]) => key !== INLINE_DECORATION_ATTRIBUTE_KEY)
		.filter(([_, value]) => value !== null && value !== false)
		.sort(([a], [b]) => {
			const schemaA = registry.resolveInline(a);
			const schemaB = registry.resolveInline(b);
			return (schemaA?.priority ?? 0) - (schemaB?.priority ?? 0);
		});

	for (const [markType, markProps] of entries) {
		const element = createMarkElement(markType, markProps, policy, doc);
		element.appendChild(wrapped);
		wrapped = element;
	}

	if (decorationAttributes) {
		const element = createMarkElement(
			INLINE_DECORATION_ATTRIBUTE_KEY,
			decorationAttributes,
			policy,
			doc,
		);
		element.appendChild(wrapped);
		wrapped = element;
	}

	return wrapped;
}

export function createMarkedNode(
	text: string,
	attributes: Record<string, unknown>,
	registry: SchemaRegistry,
	policy: UrlPolicy = urlPolicy,
	doc: Document = document,
): Node {
	const node: Node = doc.createTextNode(text);
	return wrapWithMarks(node, attributes, registry, policy);
}

function createMarkElement(
	markType: string,
	props: unknown,
	policy: UrlPolicy,
	doc: Document,
): HTMLElement {
	switch (markType) {
		case INLINE_DECORATION_ATTRIBUTE_KEY: {
			const span = doc.createElement("span");
			applyElementAttributes(span, props, policy);
			return span;
		}
		case "bold":
			return doc.createElement("strong");
		case "italic":
			return doc.createElement("em");
		case "underline":
			return doc.createElement("u");
		case "strikethrough":
			return doc.createElement("s");
		case "code":
			return doc.createElement("code");
		case "link": {
			const anchor = doc.createElement("a");
			if (typeof props === "object" && props !== null) {
				const record = props as Record<string, unknown>;
				if (record.href) {
					const href = policy.resolve(record.href, "link");
					if (href === null) {
						anchor.setAttribute("data-pen-blocked-url", "");
					} else {
						anchor.href = href;
					}
				}
				if (record.title) anchor.title = record.title as string;
			}
			return anchor;
		}
		case "highlight":
			return createColorMarkElement(props, {
				tagName: "mark",
				cssProperty: "background-color",
				customProperty: HIGHLIGHT_CUSTOM_PROPERTY,
			}, doc);
		case "textColor":
			return createColorMarkElement(props, {
				tagName: "span",
				markType: "textColor",
				cssProperty: "color",
				customProperty: TEXT_COLOR_CUSTOM_PROPERTY,
			}, doc);
		case "backgroundColor":
			return createColorMarkElement(props, {
				tagName: "span",
				markType: "backgroundColor",
				cssProperty: "background-color",
				customProperty: BACKGROUND_COLOR_CUSTOM_PROPERTY,
			}, doc);
		case "suggestion": {
			const span = doc.createElement("span");
			span.dataset.markType = markType;

			if (typeof props === "object" && props !== null) {
				const record = props as Record<string, unknown>;
				const suggestionId =
					typeof record.id === "string" && record.id.length > 0
						? record.id
						: null;
				const suggestionAction =
					record.action === "delete" ? "delete" : "insert";

				if (suggestionId) {
					span.dataset.suggestionId = suggestionId;
				}

				span.dataset.suggestionAction = suggestionAction;
				span.classList.add(
					suggestionAction === "delete"
						? REVIEW_SURFACE_CLASSES.suggestionDelete
						: REVIEW_SURFACE_CLASSES.suggestionInsert,
				);
			}

			return span;
		}
		default: {
			const span = doc.createElement("span");
			span.dataset.markType = markType;
			return span;
		}
	}
}

type ColorMarkShape = {
	tagName: "span" | "mark";
	/** Omitted for `mark`, which identifies itself as a semantic element. */
	markType?: "textColor" | "backgroundColor";
	cssProperty: "color" | "background-color";
	customProperty: string;
};

function createColorMarkElement(
	props: unknown,
	shape: ColorMarkShape,
	doc: Document,
): HTMLElement {
	const element = doc.createElement(shape.tagName);
	if (shape.markType) {
		element.dataset.markType = shape.markType;
	}

	const color = readColorProp(props);
	if (color === null) {
		return element;
	}

	element.dataset.color = color;
	// RI7: var() fallback so hosts can set the token without !important
	element.style.setProperty(
		shape.cssProperty,
		`var(${shape.customProperty}, ${color})`,
	);
	return element;
}

function readColorProp(props: unknown): string | null {
	if (typeof props !== "object" || props === null) {
		return null;
	}
	const color = (props as Record<string, unknown>).color;
	return typeof color === "string" && color.length > 0 ? color : null;
}

/**
 * Writes decoration-supplied attributes onto a rendered element, dropping any
 * that fail the URL policy so untrusted decoration props cannot inject a
 * navigable or script-bearing value.
 *
 * @param element - The element receiving the attributes.
 * @param props - Candidate attribute values; ignored unless they are a valid
 * decoration attributes object.
 * @param policy - URL policy used to vet attribute values.
 */
export function applyElementAttributes(
	element: HTMLElement,
	props: unknown,
	policy: UrlPolicy = urlPolicy,
): void {
	if (!isDecorationAttributesValue(props)) {
		return;
	}

	for (const [key, value] of Object.entries(props)) {
		if (value === null || value === false || value === undefined) {
			continue;
		}
		// SEC2: event handlers and stylesheets are not data
		if (/^on/i.test(key) || key.toLowerCase() === "style") {
			continue;
		}
		const attributeName = key.toLowerCase();
		if (
			attributeName === "href" ||
			attributeName === "src" ||
			attributeName === "xlink:href"
		) {
			const resolved = policy.resolve(
				value,
				attributeName === "src" ? "image" : "link",
			);
			if (resolved === null) {
				element.setAttribute("data-pen-blocked-url", "");
			} else {
				element.setAttribute(attributeName, resolved);
			}
			continue;
		}
		if (key === "class" && typeof value === "string") {
			element.className = value;
			continue;
		}
		if (value === true) {
			element.setAttribute(key, "");
			continue;
		}
		element.setAttribute(key, String(value));
	}
}

function isDecorationAttributesValue(
	value: unknown,
): value is Record<string, string | number | boolean> {
	return typeof value === "object" && value !== null;
}
