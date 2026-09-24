import type { DOMNode } from "./domAdapter";
import { parseSafeStyleDeclarations } from "./sanitize";

interface InlineMark {
	type: string;
	props?: Record<string, unknown>;
	start: number;
	end: number;
}

interface InlineResult {
	text: string;
	marks: InlineMark[];
}

type ActiveMark = Pick<InlineMark, "type" | "props">;
type ActiveMarks = Map<string, ActiveMark>;

const INLINE_MARK_MAP: Record<string, string> = {
	strong: "bold",
	b: "bold",
	em: "italic",
	i: "italic",
	u: "underline",
	s: "strikethrough",
	del: "strikethrough",
	strike: "strikethrough",
	code: "code",
	mark: "highlight",
};

export function parseInlineContent(node: DOMNode): InlineResult {
	const result: InlineResult = { text: "", marks: [] };
	walkInline(node, result, new Map());
	return result;
}

function walkInline(
	node: DOMNode,
	result: InlineResult,
	activeMarks: ActiveMarks,
): void {
	if (node.type === "text") {
		appendText(result, node.textContent ?? "", activeMarks);
		return;
	}

	if (node.type !== "element" || !node.tagName) {
		for (const child of node.children ?? []) {
			walkInline(child, result, activeMarks);
		}
		return;
	}

	if (node.tagName === "br") {
		appendText(result, "\n", activeMarks);
		return;
	}

	const nextMarks = new Map(activeMarks);
	const semanticMark = INLINE_MARK_MAP[node.tagName];
	if (semanticMark) {
		setMark(nextMarks, semanticMark);
	}
	if (node.tagName === "a") {
		setMark(nextMarks, "link", {
			href: node.attributes?.href ?? "",
			title: node.attributes?.title ?? undefined,
		});
	}
	applyInlineStyles(nextMarks, node.attributes?.style ?? "");

	for (const child of node.children ?? []) {
		walkInline(child, result, nextMarks);
	}
}

function applyInlineStyles(activeMarks: ActiveMarks, style: string): void {
	for (const { property, value } of parseSafeStyleDeclarations(style)) {
		if (property === "font-weight") {
			if (
				value === "bold" ||
				value === "bolder" ||
				/^[5-9]00$/.test(value)
			) {
				setMark(activeMarks, "bold");
			} else {
				activeMarks.delete("bold");
			}
			continue;
		}
		if (property === "font-style") {
			if (value === "italic" || value === "oblique") {
				setMark(activeMarks, "italic");
			} else {
				activeMarks.delete("italic");
			}
			continue;
		}
		if (
			property === "text-decoration" ||
			property === "text-decoration-line"
		) {
			const values = new Set(value.split(/\s+/));
			setMarkEnabled(activeMarks, "underline", values.has("underline"));
			setMarkEnabled(
				activeMarks,
				"strikethrough",
				values.has("line-through"),
			);
			continue;
		}
		if (property === "color") {
			setMark(activeMarks, "textColor", { color: value });
			continue;
		}
		if (property === "background-color") {
			setMark(activeMarks, "backgroundColor", { color: value });
		}
	}
}

function setMark(
	activeMarks: ActiveMarks,
	type: string,
	props?: Record<string, unknown>,
): void {
	activeMarks.set(type, props ? { type, props } : { type });
}

function setMarkEnabled(
	activeMarks: ActiveMarks,
	type: string,
	enabled: boolean,
): void {
	if (enabled) {
		setMark(activeMarks, type);
	} else {
		activeMarks.delete(type);
	}
}

function appendText(
	result: InlineResult,
	text: string,
	activeMarks: ActiveMarks,
): void {
	if (text.length === 0) {
		return;
	}
	const start = result.text.length;
	result.text += text;
	const end = result.text.length;
	for (const mark of activeMarks.values()) {
		const previous = findPreviousMark(result.marks, mark);
		if (previous?.end === start) {
			previous.end = end;
		} else {
			result.marks.push({ ...mark, start, end });
		}
	}
}

function findPreviousMark(
	marks: InlineMark[],
	active: ActiveMark,
): InlineMark | undefined {
	for (let index = marks.length - 1; index >= 0; index -= 1) {
		const mark = marks[index];
		if (mark.type === active.type && sameProps(mark.props, active.props)) {
			return mark;
		}
	}
	return undefined;
}

function sameProps(
	left: Record<string, unknown> | undefined,
	right: Record<string, unknown> | undefined,
): boolean {
	if (left === right) {
		return true;
	}
	if (!left || !right) {
		return false;
	}
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every((key) => left[key] === right[key])
	);
}
