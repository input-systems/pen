import { sortDeltaAttributes } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { resolveEditorUrl } from "../security/resolveEditorUrl";
import {
	PEN_CLIPBOARD_JSON_MIME,
	PEN_CLIPBOARD_JSON_MIME_LEGACY,
	encodePenBlocksForHtml,
	serializePenClipboardPayload,
	type Delta,
	type PenBlock,
} from "./clipboardPayload";

const HTML_ESCAPE_PATTERN = /[&<>"']/g;

const HTML_ESCAPE_REPLACEMENTS: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

function escapeHtmlText(value: string): string {
	return value.replace(
		HTML_ESCAPE_PATTERN,
		(character) => HTML_ESCAPE_REPLACEMENTS[character] ?? character,
	);
}

function emitClipboardWriteFailed(
	editor: Editor | undefined,
	error: unknown,
): void {
	if (!editor) {
		return;
	}
	editor.internals.emit("diagnostic", {
		code: "PEN_CLIPBOARD_002",
		level: "warn",
		source: "clipboard",
		message: "Clipboard write failed",
		remediation:
			"Grant clipboard permission or copy while the editor is focused.",
		error,
	});
}

export function writePenClipboard(
	penBlocks: PenBlock[],
	htmlContent: string,
	plainText: string,
	event?: ClipboardEvent,
	editor?: Editor,
): void {
	const penBlocksJson = serializePenClipboardPayload(penBlocks);
	const encodedPenBlocks = encodePenBlocksForHtml(penBlocksJson);
	const htmlWithPenData = `<meta data-pen-blocks="${encodedPenBlocks}" />${htmlContent}`;
	const clipboardPlainText = plainText;

	if (event?.clipboardData) {
		event.clipboardData.setData("text/plain", clipboardPlainText);
		event.clipboardData.setData("text/html", htmlWithPenData);
		event.clipboardData.setData(PEN_CLIPBOARD_JSON_MIME, penBlocksJson);
		event.clipboardData.setData(
			PEN_CLIPBOARD_JSON_MIME_LEGACY,
			penBlocksJson,
		);
		return;
	}

	navigator.clipboard
		.write([
			new ClipboardItem({
				[PEN_CLIPBOARD_JSON_MIME]: new Blob([penBlocksJson], {
					type: PEN_CLIPBOARD_JSON_MIME,
				}),
				[PEN_CLIPBOARD_JSON_MIME_LEGACY]: new Blob([penBlocksJson], {
					type: PEN_CLIPBOARD_JSON_MIME_LEGACY,
				}),
				"text/html": new Blob([htmlWithPenData], {
					type: "text/html",
				}),
				"text/plain": new Blob([clipboardPlainText], {
					type: "text/plain",
				}),
			}),
		])
		.catch((error: unknown) => {
			navigator.clipboard
				.writeText(clipboardPlainText)
				.catch((fallbackError: unknown) => {
					// CH5: terminal clipboard write — no remaining copy fallback.
					emitClipboardWriteFailed(editor, fallbackError ?? error);
				});
		});
}

function deltaInsertLength(insert: Delta["insert"]): number {
	if (typeof insert === "string") {
		return insert.length;
	}
	return 1;
}

function isEmbedInsert(
	insert: Delta["insert"],
): insert is { type: string; props?: Record<string, unknown> } {
	return typeof insert === "object" && insert !== null && "type" in insert;
}

export function sliceDeltas(
	deltas: readonly Delta[],
	from: number,
	to: number,
): Delta[] {
	const result: Delta[] = [];
	let offset = 0;

	for (const delta of deltas) {
		const len = deltaInsertLength(delta.insert);
		const segStart = offset;
		const segEnd = offset + len;

		if (segEnd <= from || segStart >= to) {
			offset += len;
			continue;
		}

		if (isEmbedInsert(delta.insert)) {
			result.push({
				insert: delta.insert,
				...(delta.attributes ? { attributes: delta.attributes } : {}),
			});
			offset += len;
			continue;
		}

		if (typeof delta.insert !== "string" || len === 0) {
			offset += len;
			continue;
		}

		const sliceStart = Math.max(from - segStart, 0);
		const sliceEnd = Math.min(to - segStart, len);
		const sliced = delta.insert.slice(sliceStart, sliceEnd);

		if (sliced) {
			result.push({
				insert: sliced,
				...(delta.attributes ? { attributes: delta.attributes } : {}),
			});
		}
		offset += len;
	}

	return result;
}

function atomInterchangeText(
	editor: Editor,
	insert: { type: string; props?: Record<string, unknown> },
	format: "html" | "markdown" | "text",
): string {
	const inlineSchema = editor.schema.resolveInline(insert.type);
	if (!inlineSchema || inlineSchema.kind !== "node") {
		return "";
	}
	const props = insert.props ?? {};
	const toText = inlineSchema.serialize?.toText;
	const toMarkdown = inlineSchema.serialize?.toMarkdown;
	const toHTML = inlineSchema.serialize?.toHTML;
	const plain = toText?.(props) ?? toMarkdown?.("", props) ?? "";

	if (format === "html") {
		if (toHTML) {
			return toHTML("", props);
		}
		return plain ? escapeHtmlText(plain) : "";
	}
	if (format === "markdown") {
		return toMarkdown?.("", props) ?? toText?.(props) ?? "";
	}
	return plain;
}

export function serializeDeltasToFormat(
	deltas: readonly Delta[],
	editor: Editor,
	format: "html" | "markdown" | "text",
): string {
	if (deltas.length === 0) return "";

	let result = "";
	for (const delta of deltas) {
		if (isEmbedInsert(delta.insert)) {
			result += atomInterchangeText(editor, delta.insert, format);
			continue;
		}
		if (typeof delta.insert !== "string") continue;
		let text = delta.insert;
		if (!text) continue;
		if (format === "html") {
			text = escapeHtmlText(text);
		}

		if (delta.attributes) {
			const ordered = sortDeltaAttributes(
				delta.attributes,
				editor.schema,
			);
			for (const [mark, props] of Object.entries(ordered)) {
				const inlineSchema = editor.schema.resolveInline(mark);
				if (format === "html") {
					if (!inlineSchema?.serialize?.toHTML) continue;
					const rawProps =
						typeof props === "object"
							? (props as Record<string, unknown>)
							: {};
					text = inlineSchema.serialize.toHTML(
						text,
						mark === "link"
							? admitClipboardLinkProps(editor, rawProps)
							: rawProps,
					);
				} else if (format === "markdown") {
					if (!inlineSchema?.serialize?.toMarkdown) continue;
					text = inlineSchema.serialize.toMarkdown(
						text,
						typeof props === "object"
							? (props as Record<string, unknown>)
							: {},
					);
				}
			}
		}

		result += text;
	}

	return result;
}

function admitClipboardLinkProps(
	editor: Editor,
	props: Record<string, unknown>,
): Record<string, unknown> {
	const href = resolveEditorUrl(editor, props.href, "link");
	if (href === null) {
		const admitted = { ...props };
		delete admitted.href;
		return admitted;
	}
	return { ...props, href };
}
