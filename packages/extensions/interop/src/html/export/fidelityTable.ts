import {
	renderFidelityTable,
	type ExportFidelityRow,
} from "../../fidelityTable";

export const HTML_EXPORT_FIDELITY: readonly ExportFidelityRow[] = [
	{ kind: "block", type: "paragraph", fidelity: "full", notes: "" },
	{ kind: "block", type: "heading", fidelity: "full", notes: "" },
	{ kind: "block", type: "bulletListItem", fidelity: "full", notes: "" },
	{
		kind: "block",
		type: "numberedListItem",
		fidelity: "degraded",
		notes: "start offset dropped; items wrap in ol",
	},
	{ kind: "block", type: "checkListItem", fidelity: "full", notes: "" },
	{ kind: "block", type: "codeBlock", fidelity: "full", notes: "" },
	{
		kind: "block",
		type: "image",
		fidelity: "degraded",
		notes: "caption dropped; hostile src omitted (SEC1)",
	},
	{ kind: "block", type: "table", fidelity: "full", notes: "" },
	{ kind: "block", type: "divider", fidelity: "full", notes: "" },
	{
		kind: "block",
		type: "callout",
		fidelity: "degraded",
		notes: "children exported as sibling blocks, not nested in the callout div",
	},
	{
		kind: "block",
		type: "toggle",
		fidelity: "degraded",
		notes: "children exported as sibling blocks, not nested in details",
	},
	{ kind: "block", type: "blockquote", fidelity: "full", notes: "" },
	{
		kind: "block",
		type: "subdocument",
		fidelity: "degraded",
		notes: "empty data-pen-subdocument marker; nested document dropped",
	},
	{ kind: "mark", type: "bold", fidelity: "full", notes: "" },
	{ kind: "mark", type: "italic", fidelity: "full", notes: "" },
	{ kind: "mark", type: "underline", fidelity: "full", notes: "" },
	{ kind: "mark", type: "strikethrough", fidelity: "full", notes: "" },
	{ kind: "mark", type: "highlight", fidelity: "full", notes: "" },
	{ kind: "mark", type: "textColor", fidelity: "full", notes: "" },
	{ kind: "mark", type: "backgroundColor", fidelity: "full", notes: "" },
	{
		kind: "mark",
		type: "link",
		fidelity: "full",
		notes: "hostile href omitted (SEC1)",
	},
	{ kind: "mark", type: "code", fidelity: "full", notes: "" },
	{
		kind: "inline-node",
		type: "mention",
		fidelity: "dropped",
		notes: "non-string inserts omitted",
	},
	{
		kind: "inline-node",
		type: "inlineApp",
		fidelity: "dropped",
		notes: "non-string inserts omitted",
	},
];

export function renderHtmlFidelityTable(): string {
	return renderFidelityTable(
		"HTML export fidelity (IOP3)",
		"What the HTML exporter preserves for each default block, mark, and inline node. Schema `toHTML` attribute interpolations are deferred to a later S.5 slice.",
		"src/html/export",
		HTML_EXPORT_FIDELITY,
	);
}
