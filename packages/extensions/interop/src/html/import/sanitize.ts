import DOMPurify from "isomorphic-dompurify";
import { DomUtils, parseDocument } from "htmlparser2";
import type { ChildNode, Document, Element } from "domhandler";

const ALLOWED_INLINE_STYLE_PROPS = new Set([
	"color",
	"background-color",
	"font-style",
	"font-weight",
	"text-align",
	"text-decoration",
	"text-decoration-line",
]);

const ALLOWED_FONT_STYLE_VALUES = new Set(["normal", "italic", "oblique"]);

const ALLOWED_FONT_WEIGHT_VALUES = new Set([
	"normal",
	"bold",
	"bolder",
	"lighter",
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900",
]);

const ALLOWED_TEXT_DECORATION_VALUES = new Set([
	"none",
	"underline",
	"line-through",
]);

const ALLOWED_TEXT_ALIGN_VALUES = new Set([
	"left",
	"right",
	"center",
	"justify",
	"start",
	"end",
]);

const ALLOWED_HTML_ALIGN_VALUES = new Set([
	"left",
	"right",
	"center",
	"justify",
]);

const HOSTILE_STYLE_VALUE = /\/\*|\burl\s*\(|\bexpression\s*\(|\\/i;

/**
 * `data-pen-*` names `domToBlocks` / `inlineParser` actually read.
 * Conversion uses tags, class, href, src, style, align, and a few HTML attrs — no
 * `data-pen-*` today. Keep this list exact; do not add a `data-*` wildcard.
 */
export const ALLOWED_DATA_PEN_ATTRS: readonly string[] = Object.freeze([]);

const PURIFY_CONFIG = {
	ALLOWED_TAGS: [
		"p",
		"br",
		"hr",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"ul",
		"ol",
		"li",
		"a",
		"strong",
		"b",
		"em",
		"i",
		"u",
		"s",
		"del",
		"strike",
		"code",
		"pre",
		"blockquote",
		"table",
		"thead",
		"tbody",
		"tr",
		"th",
		"td",
		"img",
		"mark",
		"span",
		"div",
		"details",
		"summary",
		"input",
	],
	ALLOWED_ATTR: [
		"href",
		"src",
		"alt",
		"title",
		"width",
		"height",
		"class",
		"colspan",
		"rowspan",
		"type",
		"checked",
		"disabled",
		"style",
		"align",
		"start",
		"open",
		...ALLOWED_DATA_PEN_ATTRS,
	],
	ALLOW_DATA_ATTR: false,
	FORBID_TAGS: [
		"script",
		"style",
		"iframe",
		"object",
		"embed",
		"applet",
		"form",
		"noscript",
		"template",
		"math",
		"svg",
	],
	FORBID_ATTR: ["onerror", "onclick", "onload", "onmouseover"],
	RETURN_TRUSTED_TYPE: false,
};

type SanitizeAttributeHookEvent = {
	attrName: string;
	attrValue: string;
	keepAttr: boolean;
};

function admitKeywordValue(
	raw: string,
	allowed: ReadonlySet<string>,
): string | null {
	if (HOSTILE_STYLE_VALUE.test(raw)) {
		return null;
	}
	const normalized = raw
		.replace(/\s*!important\s*$/i, "")
		.trim()
		.toLowerCase();
	if (!allowed.has(normalized)) {
		return null;
	}
	return normalized;
}

function admitStylePropertyValue(
	property: string,
	propertyValue: string,
): string | null {
	if (property === "font-style") {
		return admitKeywordValue(propertyValue, ALLOWED_FONT_STYLE_VALUES);
	}
	if (property === "font-weight") {
		return admitKeywordValue(propertyValue, ALLOWED_FONT_WEIGHT_VALUES);
	}
	if (property === "text-align") {
		return admitKeywordValue(propertyValue, ALLOWED_TEXT_ALIGN_VALUES);
	}
	if (property === "text-decoration" || property === "text-decoration-line") {
		return admitKeywordList(propertyValue, ALLOWED_TEXT_DECORATION_VALUES);
	}
	return propertyValue;
}

function admitKeywordList(
	raw: string,
	allowed: ReadonlySet<string>,
): string | null {
	if (HOSTILE_STYLE_VALUE.test(raw)) {
		return null;
	}
	const values = raw
		.replace(/\s*!important\s*$/i, "")
		.trim()
		.toLowerCase()
		.split(/\s+/);
	if (
		values.length === 0 ||
		values.some((value) => !allowed.has(value)) ||
		(values.includes("none") && values.length > 1)
	) {
		return null;
	}
	return [...new Set(values)].join(" ");
}

type SafeStyleDeclaration = {
	property: string;
	value: string;
};

export function parseSafeStyleDeclarations(
	value: string,
): SafeStyleDeclaration[] {
	const declarations = new Map<string, SafeStyleDeclaration>();
	for (const rawDeclaration of value.split(";")) {
		const declaration = rawDeclaration.trim();
		if (declaration.length === 0) {
			continue;
		}
		const separatorIndex = declaration.indexOf(":");
		if (separatorIndex < 0) {
			continue;
		}
		const property = declaration
			.slice(0, separatorIndex)
			.trim()
			.toLowerCase();
		const propertyValue = declaration.slice(separatorIndex + 1).trim();
		if (
			!ALLOWED_INLINE_STYLE_PROPS.has(property) ||
			propertyValue.length === 0
		) {
			continue;
		}
		const admitted = admitStylePropertyValue(property, propertyValue);
		if (admitted === null) {
			continue;
		}
		declarations.delete(property);
		declarations.set(property, { property, value: admitted });
	}
	return [...declarations.values()];
}

function filterInlineStyleDeclarations(value: string): string {
	return parseSafeStyleDeclarations(value)
		.map(({ property, value: propertyValue }) =>
			`${property}: ${propertyValue}`,
		)
		.join("; ");
}

type SafeStylesheetRule = {
	tagName?: string;
	className: string;
	declarations: SafeStyleDeclaration[];
	specificity: number;
};

type CascadedStyleDeclaration = SafeStyleDeclaration & {
	specificity: number;
	order: number;
};

type SafeStylesheetClassRules = {
	classDeclarations: Map<string, CascadedStyleDeclaration>;
	tagDeclarations: Map<string, Map<string, CascadedStyleDeclaration>>;
};

const SIMPLE_CLASS_SELECTOR = /^([a-z][a-z0-9-]*)?\.([_a-z][-_a-z0-9]*)$/i;

function parseSafeStylesheetRules(css: string): SafeStylesheetRule[] {
	const rules: SafeStylesheetRule[] = [];
	css = stripCssComments(css);
	let selectorStart = 0;
	let bodyStart = 0;
	let depth = 0;
	let hasNestedBlock = false;

	for (let index = 0; index < css.length; index += 1) {
		const character = css[index];
		if (character === "{") {
			if (depth === 0) {
				bodyStart = index + 1;
				hasNestedBlock = false;
			} else {
				hasNestedBlock = true;
			}
			depth += 1;
			continue;
		}
		if (character !== "}" || depth === 0) {
			continue;
		}
		depth -= 1;
		if (depth !== 0) {
			continue;
		}

		const selectorText = css.slice(selectorStart, bodyStart - 1).trim();
		const declarations = hasNestedBlock
			? []
			: parseSafeStyleDeclarations(css.slice(bodyStart, index));
		if (declarations.length > 0 && !selectorText.startsWith("@")) {
			for (const selector of selectorText.split(",")) {
				const match = SIMPLE_CLASS_SELECTOR.exec(selector.trim());
				if (!match) {
					continue;
				}
				rules.push({
					...(match[1] ? { tagName: match[1].toLowerCase() } : {}),
					className: match[2]!,
					declarations,
					specificity: match[1] ? 11 : 10,
				});
			}
		}
		selectorStart = index + 1;
	}

	return rules;
}

function stripCssComments(css: string): string {
	let result = "";
	let index = 0;
	while (index < css.length) {
		if (css[index] === "/" && css[index + 1] === "*") {
			const end = css.indexOf("*/", index + 2);
			result += " ";
			index = end < 0 ? css.length : end + 2;
			continue;
		}
		result += css[index];
		index += 1;
	}
	return result;
}

function collectSafeStylesheetRules(
	node: Document | ChildNode,
): SafeStylesheetRule[] {
	const rules: SafeStylesheetRule[] = [];
	if (node.type === "style") {
		rules.push(...parseSafeStylesheetRules(DomUtils.textContent(node)));
	}
	if ("children" in node) {
		for (const child of node.children) {
			rules.push(...collectSafeStylesheetRules(child));
		}
	}
	return rules;
}

function inlineSafeStylesheetDeclarations(html: string): string {
	if (!/<style(?:\s|>)/i.test(html)) {
		return html;
	}
	const document = parseDocument(html);
	const rules = collectSafeStylesheetRules(document).map((rule, order) => ({
		...rule,
		order,
	}));
	if (rules.length === 0) {
		return html;
	}
	const rulesByClass = new Map<string, SafeStylesheetClassRules>();
	for (const rule of rules) {
		const classRules = rulesByClass.get(rule.className) ?? {
			classDeclarations: new Map(),
			tagDeclarations: new Map(),
		};
		const declarations = rule.tagName
			? (classRules.tagDeclarations.get(rule.tagName) ?? new Map())
			: classRules.classDeclarations;
		for (const declaration of rule.declarations) {
			declarations.set(declaration.property, {
				...declaration,
				specificity: rule.specificity,
				order: rule.order,
			});
		}
		if (rule.tagName) {
			classRules.tagDeclarations.set(rule.tagName, declarations);
		}
		rulesByClass.set(rule.className, classRules);
	}

	function visit(node: Document | ChildNode): void {
		if (node.type === "tag") {
			const element = node as Element;
			const classNames = new Set(
				(element.attribs.class ?? "").split(/\s+/).filter(Boolean),
			);
			const declarations = new Map<string, CascadedStyleDeclaration>();
			for (const className of classNames) {
				const classRules = rulesByClass.get(className);
				if (!classRules) {
					continue;
				}
				for (const candidates of [
					classRules.classDeclarations,
					classRules.tagDeclarations.get(element.name),
				]) {
					if (!candidates) {
						continue;
					}
					mergeCascadedDeclarations(declarations, candidates);
				}
			}

			if (declarations.size > 0) {
				for (const declaration of parseSafeStyleDeclarations(
					element.attribs.style ?? "",
				)) {
					declarations.set(declaration.property, {
						...declaration,
						specificity: Number.POSITIVE_INFINITY,
						order: Number.POSITIVE_INFINITY,
					});
				}
				element.attribs.style = [...declarations.values()]
					.map(({ property, value }) => `${property}: ${value}`)
					.join("; ");
			}
		}
		if ("children" in node) {
			for (const child of node.children) {
				visit(child);
			}
		}
	}

	visit(document);
	return DomUtils.getOuterHTML(document);
}

function mergeCascadedDeclarations(
	target: Map<string, CascadedStyleDeclaration>,
	candidates: Map<string, CascadedStyleDeclaration>,
): void {
	for (const declaration of candidates.values()) {
		const current = target.get(declaration.property);
		if (
			current === undefined ||
			declaration.specificity > current.specificity ||
			(declaration.specificity === current.specificity &&
				declaration.order > current.order)
		) {
			target.set(declaration.property, declaration);
		}
	}
}

function uponSanitizeAttribute(
	_node: Node,
	data: SanitizeAttributeHookEvent,
): void {
	if (data.attrName === "align") {
		const admitted = admitKeywordValue(
			data.attrValue,
			ALLOWED_HTML_ALIGN_VALUES,
		);
		if (admitted === null) {
			data.keepAttr = false;
			data.attrValue = "";
			return;
		}
		data.attrValue = admitted;
		return;
	}
	if (data.attrName !== "style") {
		return;
	}
	const nextStyle = filterInlineStyleDeclarations(data.attrValue);
	if (nextStyle.length === 0) {
		data.keepAttr = false;
		data.attrValue = "";
		return;
	}
	data.attrValue = nextStyle;
}

export function sanitizeHTML(html: string): string {
	DOMPurify.addHook("uponSanitizeAttribute", uponSanitizeAttribute);
	try {
		return DOMPurify.sanitize(
			inlineSafeStylesheetDeclarations(html),
			PURIFY_CONFIG,
		) as string;
	} finally {
		DOMPurify.removeHook("uponSanitizeAttribute");
	}
}
