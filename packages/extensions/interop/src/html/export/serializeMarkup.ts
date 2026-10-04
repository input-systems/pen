import { escapeMarkupAttribute, escapeMarkupText } from "../../escapeMarkup";

export type MarkupAttributeValue = string | number | boolean | null | undefined;

export function serializeMarkupText(value: string): string {
	return escapeMarkupText(value);
}

export function serializeMarkupOpenTag(
	tag: string,
	attributes?: Record<string, MarkupAttributeValue>,
): string {
	let result = `<${tag}`;
	if (attributes) {
		for (const [name, raw] of Object.entries(attributes)) {
			if (raw == null || raw === false) {
				continue;
			}
			if (raw === true) {
				result += ` ${name}`;
				continue;
			}
			result += ` ${name}="${escapeMarkupAttribute(String(raw))}"`;
		}
	}
	return `${result}>`;
}

export function serializeMarkupCloseTag(tag: string): string {
	return `</${tag}>`;
}

export function serializeMarkupElement(
	tag: string,
	attributes: Record<string, MarkupAttributeValue> | undefined,
	innerSerialized: string,
): string {
	return `${serializeMarkupOpenTag(tag, attributes)}${innerSerialized}${serializeMarkupCloseTag(tag)}`;
}
