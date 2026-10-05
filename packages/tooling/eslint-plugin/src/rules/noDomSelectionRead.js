import {
	memberName,
	selectionLintMeta,
	selectionLintReporter,
} from "./selectionLintShared.js";

/**
 * S1 (`spec/rules/selection.md`): one reader. In the renderer packages only
 * the selection reader calls `getSelection()`, listens for `selectionchange`,
 * or maps the live DOM selection. There is no allowlist: every other site is
 * an error.
 * The authority read `editor.getSelection()` and `InputEvent.getTargetRanges()`
 * are not DOM selection reads.
 */

const OWNER = "packages/rendering/dom/src/field-editor/selectionReader.ts";
/**
 * The writer takes the `Selection` it writes through from the reader's
 * `nativeSelectionForWrite`; any other caller would be reading through it.
 */
const WRITE_HANDLE = "nativeSelectionForWrite";
const WRITER = "packages/rendering/dom/src/field-editor/selectionProjector.ts";

/** Receivers whose `getSelection()` is the document's selection. */
const DOCUMENT_RECEIVERS = new Set([
	"window",
	"self",
	"globalThis",
	"document",
	"doc",
	"ownerDocument",
	"defaultView",
]);
const DOCUMENT_MEMBERS = new Set(["ownerDocument", "document", "defaultView"]);
const LISTENER_METHODS = new Set([
	"addEventListener",
	"removeEventListener",
	"listen",
	"listenDocument",
]);
/** Helpers that map the live DOM selection. */
const LIVE_MAPPERS = new Set([
	"domSelectionToEditor",
	"getSelectionOffsets",
	"getDirectionalSelectionOffsets",
	"getCaretOffset",
]);

/** Unwraps `x!` and `x as T`. */
function unwrap(node) {
	let current = node;
	while (
		current?.type === "TSNonNullExpression" ||
		current?.type === "TSAsExpression"
	) {
		current = current.expression;
	}
	return current;
}

function isDocumentReceiver(receiver) {
	const node = unwrap(receiver);
	if (node?.type === "Identifier") return DOCUMENT_RECEIVERS.has(node.name);
	return DOCUMENT_MEMBERS.has(memberName(node));
}

function calleeName(callee) {
	return callee.type === "Identifier" ? callee.name : memberName(callee);
}

function isSelectionChangeLiteral(node) {
	return node?.type === "Literal" && node.value === "selectionchange";
}

/** The read a call performs, or null. */
function readApi(node) {
	const callee = node.callee;
	const name = calleeName(callee);
	if (name === "getSelection") {
		if (callee.type === "Identifier" || isDocumentReceiver(callee.object)) {
			return "getSelection";
		}
		return null;
	}
	if (
		LISTENER_METHODS.has(name) &&
		node.arguments.some(isSelectionChangeLiteral)
	) {
		return "selectionchange";
	}
	if (name === WRITE_HANDLE) return WRITE_HANDLE;
	return LIVE_MAPPERS.has(name) ? name : null;
}

export const noDomSelectionRead = {
	meta: selectionLintMeta({
		description: "Only the selection reader reads the DOM selection (S1)",
		kind: "read",
		violation:
			"`{{api}}` in `{{symbol}}` ({{file}}) reads the DOM selection outside the reader (S1). Read the selection authority, or take the range from the event.",
	}),
	create(context) {
		const reporter = selectionLintReporter(context, {
			owner: OWNER,
			messageId: "read",
		});
		if (!reporter) return {};

		return {
			CallExpression(node) {
				const api = readApi(node);
				if (!api) return;
				if (api === WRITE_HANDLE && reporter.file === WRITER) return;
				reporter.report(node, api);
			},
			MemberExpression(node) {
				if (memberName(node) === "onselectionchange") {
					reporter.report(node, "onselectionchange");
				}
			},
		};
	},
};
