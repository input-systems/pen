import {
	sortDeltaAttributes,
	urlPolicy,
	type UrlContext,
} from "@input/pen-core";
import type {
	BlockHandle,
	Editor,
	Exporter,
	ExportOptions,
	TableCellHandle,
} from "@input/pen-types";
import type { MarkupAttributeValue } from "./serializeMarkup";
import {
	serializeMarkupCloseTag,
	serializeMarkupElement,
	serializeMarkupOpenTag,
	serializeMarkupText,
} from "./serializeMarkup";

export type HtmlExportViewMode = "resolved" | "raw";

type HtmlExporterExtraOptions = Record<string, unknown> & {
	viewMode?: HtmlExportViewMode;
};

const DELETE_SUGGESTION_ACTION = "delete";

// Export emits the logical text domain. Apply executors still persist the
// empty-block sentinel in storage; this file does not test for it.

export const htmlExporter: Exporter<string, HtmlExporterExtraOptions> = {
	name: "html",
	mimeType: "text/html",
	fileExtension: ".html",

	export(
		editor: Editor,
		options?: ExportOptions<HtmlExporterExtraOptions>,
	): string {
		const viewMode =
			options?.extra?.viewMode ??
			(options?.includeSuggestions === false ? "resolved" : "raw");
		// Export is a document-preservation surface: serialize the actual document
		// graph, including nested and non-default-authoring blocks that already exist.
		const handles = [...editor.documentState.allBlocks()];
		const parts: string[] = [];
		for (let index = 0; index < handles.length; index++) {
			const handle = handles[index]!;

			if (isListHandle(handle)) {
				const { html, nextIndex } = renderListRunHTML(
					handles,
					index,
					editor,
					viewMode,
				);
				parts.push(html);
				index = nextIndex - 1;
				continue;
			}

			if (handle.type === "table") {
				parts.push(renderTableHTML(handle, editor, viewMode));
				continue;
			}

			if (handle.type === "image") {
				parts.push(serializeImageBlockHTML(handle, editor));
				continue;
			}

			const schema = editor.schema.resolve(handle.type);
			if (!schema?.serialize?.toHTML) {
				parts.push(
					serializeMarkupElement(
						"p",
						undefined,
						serializeMarkupText(handle.textContent()),
					),
				);
				continue;
			}

			const block = {
				id: handle.id,
				type: handle.type,
				props: handle.props,
				content: serializeInlineContentHTML(handle, editor, viewMode),
			};

			parts.push(schema.serialize.toHTML(block));
		}

		return parts.join("\n");
	},
};

function serializeInlineContentHTML(
	handle: BlockHandle,
	editor: Editor,
	viewMode: HtmlExportViewMode,
): string {
	const deltas = handle.textDeltas();
	if (!deltas || deltas.length === 0) {
		return serializeMarkupText(
			viewMode === "resolved"
				? handle.textContent({ resolved: true })
				: handle.textContent(),
		);
	}

	return serializeDeltasHTML(deltas, editor, viewMode);
}

function renderTableHTML(
	handle: BlockHandle,
	editor: Editor,
	viewMode: HtmlExportViewMode,
): string {
	const table = handle.as("table");
	const rowCount = table?.tableRowCount() ?? 0;
	const colCount = table?.tableColumnCount() ?? 0;
	const hasHeaderRow = handle.props.hasHeaderRow !== false;
	const parts = [serializeMarkupOpenTag("table")];

	if (hasHeaderRow && rowCount > 0) {
		parts.push(
			`${serializeMarkupOpenTag("thead")}${serializeMarkupOpenTag("tr")}`,
		);
		for (let columnIndex = 0; columnIndex < colCount; columnIndex++) {
			parts.push(
				serializeMarkupElement(
					"th",
					undefined,
					serializeTableCellHTML(
						table?.tableCell(0, columnIndex) ?? null,
						editor,
						viewMode,
					),
				),
			);
		}
		parts.push(
			`${serializeMarkupCloseTag("tr")}${serializeMarkupCloseTag("thead")}`,
		);
	}

	const bodyStart = hasHeaderRow ? 1 : 0;
	if (bodyStart < rowCount) {
		parts.push(serializeMarkupOpenTag("tbody"));
		for (let rowIndex = bodyStart; rowIndex < rowCount; rowIndex++) {
			parts.push(serializeMarkupOpenTag("tr"));
			for (let columnIndex = 0; columnIndex < colCount; columnIndex++) {
				parts.push(
					serializeMarkupElement(
						"td",
						undefined,
						serializeTableCellHTML(
							table?.tableCell(rowIndex, columnIndex) ?? null,
							editor,
							viewMode,
						),
					),
				);
			}
			parts.push(serializeMarkupCloseTag("tr"));
		}
		parts.push(serializeMarkupCloseTag("tbody"));
	}

	parts.push(serializeMarkupCloseTag("table"));
	return parts.join("");
}

function serializeTableCellHTML(
	cell: TableCellHandle | null,
	editor: Editor,
	viewMode: HtmlExportViewMode,
): string {
	if (!cell) {
		return "";
	}

	return serializeDeltasHTML(cell.textDeltas(), editor, viewMode);
}

/**
 * Escaped text wrapped in its marks, in schema mark order. Resolved view
 * drops suggested deletions and the suggestion mark itself.
 */
function serializeDeltasHTML(
	deltas: ReturnType<BlockHandle["textDeltas"]>,
	editor: Editor,
	viewMode: HtmlExportViewMode,
): string {
	let result = "";
	for (const delta of deltas) {
		let text =
			typeof delta.insert === "string"
				? serializeMarkupText(delta.insert)
				: "";
		if (typeof delta.insert === "string" && delta.insert === "") {
			continue;
		}

		const suggestion = delta.attributes?.suggestion as
			{ action?: string } | undefined;
		if (
			viewMode === "resolved" &&
			suggestion?.action === DELETE_SUGGESTION_ACTION
		) {
			continue;
		}

		if (delta.attributes) {
			const ordered = sortDeltaAttributes(
				delta.attributes,
				editor.schema,
			);
			for (const [mark, props] of Object.entries(ordered)) {
				if (viewMode === "resolved" && mark === "suggestion") {
					continue;
				}
				text = wrapInlineMarkHTML(text, mark, props, editor);
			}
		}

		result += text;
	}

	return result;
}

function isListHandle(handle: BlockHandle): boolean {
	return (
		handle.type === "bulletListItem" ||
		handle.type === "numberedListItem" ||
		handle.type === "checkListItem"
	);
}

function renderListRunHTML(
	handles: BlockHandle[],
	startIndex: number,
	editor: Editor,
	viewMode: HtmlExportViewMode,
): { html: string; nextIndex: number } {
	const run: BlockHandle[] = [];
	let index = startIndex;
	while (index < handles.length && isListHandle(handles[index]!)) {
		run.push(handles[index]!);
		index += 1;
	}

	let html = "";
	const stack: Array<{ tag: "ul" | "ol"; indent: number }> = [];

	for (let itemIndex = 0; itemIndex < run.length; itemIndex++) {
		const handle = run[itemIndex]!;
		const indent = Number(handle.props.indent ?? 0);
		const tag = handle.type === "numberedListItem" ? "ol" : "ul";

		if (stack.length === 0) {
			html += serializeMarkupOpenTag(tag);
			stack.push({ tag, indent });
		} else {
			let top = stack[stack.length - 1]!;
			if (indent > top.indent) {
				html += serializeMarkupOpenTag(tag);
				stack.push({ tag, indent });
				top = stack[stack.length - 1]!;
			} else {
				html += serializeMarkupCloseTag("li");
				while (
					stack.length > 0 &&
					indent < stack[stack.length - 1]!.indent
				) {
					html += `${serializeMarkupCloseTag(stack.pop()!.tag)}${serializeMarkupCloseTag("li")}`;
				}
				if (
					stack.length === 0 ||
					stack[stack.length - 1]!.tag !== tag
				) {
					if (stack.length > 0) {
						html += serializeMarkupCloseTag(stack.pop()!.tag);
					}
					html += serializeMarkupOpenTag(tag);
					stack.push({ tag, indent });
				}
			}
		}

		const item = renderListItemHTML(handle, editor, viewMode);
		html += `${item.openTag}${item.inner}`;
	}

	while (stack.length > 0) {
		html += `${serializeMarkupCloseTag("li")}${serializeMarkupCloseTag(stack.pop()!.tag)}`;
	}

	return { html, nextIndex: index };
}

function renderListItemHTML(
	handle: BlockHandle,
	editor: Editor,
	viewMode: HtmlExportViewMode,
): { openTag: string; inner: string } {
	const schema = editor.schema.resolve(handle.type);
	if (!schema?.serialize?.toHTML) {
		return {
			openTag: serializeMarkupOpenTag("li"),
			inner: serializeMarkupText(handle.textContent()),
		};
	}

	const block = {
		id: handle.id,
		type: handle.type,
		props: handle.props,
		content: serializeInlineContentHTML(handle, editor, viewMode),
	};
	return unwrapListItemHtml(schema.serialize.toHTML(block));
}

function unwrapListItemHtml(html: string): { openTag: string; inner: string } {
	const openMatch = /^<li\b[^>]*>/i.exec(html);
	if (!openMatch) {
		return {
			openTag: serializeMarkupOpenTag("li"),
			inner: html,
		};
	}
	const openTag = openMatch[0];
	let inner = html.slice(openTag.length);
	if (/<\/li>$/i.test(inner)) {
		inner = inner.slice(0, -"</li>".length);
	}
	return { openTag, inner };
}

function urlAttributes(
	name: "href" | "src",
	raw: unknown,
	context: UrlContext,
): Record<string, MarkupAttributeValue> {
	const resolved = urlPolicy.resolve(raw, context);
	if (resolved == null) {
		return { "data-pen-blocked-url": "" };
	}
	return { [name]: resolved };
}

function serializeImageBlockHTML(handle: BlockHandle, editor: Editor): string {
	const schema = editor.schema.resolve(handle.type);
	if (schema?.serialize?.toHTML) {
		const block = {
			id: handle.id,
			type: handle.type,
			props: handle.props,
			content: "",
		};
		return applyImageUrlPolicyToHtml(schema.serialize.toHTML(block));
	}
	return serializeImageHTML(handle);
}

function serializeImageHTML(handle: BlockHandle): string {
	const attributes: Record<string, MarkupAttributeValue> = {
		...urlAttributes("src", handle.props.src, "image"),
	};
	if (handle.props.alt) {
		attributes.alt = String(handle.props.alt);
	}
	if (handle.props.width) {
		attributes.width = String(handle.props.width);
	}
	return serializeSelfClosingImage(attributes);
}

function serializeSelfClosingImage(
	attributes: Record<string, MarkupAttributeValue>,
): string {
	const open = serializeMarkupOpenTag("img", attributes);
	return `${open.slice(0, -1)} />`;
}

const MARKUP_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|apos);/g;

const MARKUP_ENTITY_REPLACEMENTS: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&apos;": "'",
};

function unescapeMarkupAttribute(value: string): string {
	return value.replace(
		MARKUP_ENTITY_PATTERN,
		(entity) => MARKUP_ENTITY_REPLACEMENTS[entity] ?? entity,
	);
}

function parseMarkupAttributes(
	blob: string,
): Record<string, MarkupAttributeValue> {
	const attributes: Record<string, MarkupAttributeValue> = {};
	const pattern = /([^\s=]+)(?:=("([^"]*)"|'([^']*)'|(\S+)))?/g;
	for (const match of blob.matchAll(pattern)) {
		const name = match[1]!;
		if (match[2] == null) {
			attributes[name] = true;
			continue;
		}
		const raw = match[3] ?? match[4] ?? match[5] ?? "";
		attributes[name] = unescapeMarkupAttribute(raw);
	}
	return attributes;
}

function applyImageUrlPolicyToHtml(html: string): string {
	return html.replace(
		/<img\b([^>]*?)\s*\/?\s*>/gi,
		(_full, attrBlob: string) => {
			const attributes = parseMarkupAttributes(attrBlob);
			const rawSrc = attributes.src;
			delete attributes.src;
			return serializeSelfClosingImage({
				...urlAttributes("src", rawSrc, "image"),
				...attributes,
			});
		},
	);
}

function serializeLinkHTML(text: string, props: unknown): string {
	const record =
		typeof props === "object" && props !== null
			? (props as Record<string, unknown>)
			: {};
	const attributes: Record<string, MarkupAttributeValue> = {
		...urlAttributes("href", record.href, "link"),
	};
	if (record.title != null && String(record.title) !== "") {
		attributes.title = String(record.title);
	}
	return serializeMarkupElement("a", attributes, text);
}

function wrapInlineMarkHTML(
	text: string,
	mark: string,
	props: unknown,
	editor: Editor,
): string {
	if (mark === "link") {
		return serializeLinkHTML(text, props);
	}
	const inlineSchema = editor.schema.resolveInline(mark);
	if (!inlineSchema?.serialize?.toHTML) {
		return text;
	}
	return inlineSchema.serialize.toHTML(
		text,
		typeof props === "object" && props !== null
			? (props as Record<string, unknown>)
			: {},
	);
}
