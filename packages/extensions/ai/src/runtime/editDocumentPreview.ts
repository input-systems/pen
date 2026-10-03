import { toStreamingPreviewText } from "./streamingPreviewText";

const TRUNCATED_EDIT_DOCUMENT_MARKER = "truncated";

/** Where `insert_blocks` and `move_block` place content relative to their block. */
export type EditDocumentPreviewPlacement = "before" | "after";

export interface EditDocumentPreviewUpdate {
	toolCallId: string;
	/**
	 * Which operation of the payload is arriving, counting from zero.
	 *
	 * A payload holds several operations (EC4) and they arrive in order, so the
	 * one at the end of the fragment is the one being written. Consumers key
	 * their state on this: an operation that has stopped arriving is final, and
	 * its preview must not be mistaken for the next one's.
	 */
	operationIndex: number;
	blockId: string | null;
	/**
	 * Every block id the arriving operation names — `blockIds`, else
	 * `[blockId]` — each only once its closing quote has arrived. A replace or
	 * delete covers all of them, so a preview that read only the first would
	 * leave the rest looking untouched (RS6).
	 */
	blockIds: readonly string[];
	/**
	 * `placement` for `insert_blocks` and `move_block`, once terminated. An
	 * insert placed before its block previews before it (RS6).
	 */
	placement: EditDocumentPreviewPlacement | null;
	/**
	 * The arriving operation's name, when the fragment has reached it. The host
	 * needs it to place the preview: text arriving for `insert_blocks` is added
	 * beside the block it names, while a replace op covers that block's text.
	 */
	operation: string | null;
	/** What the preview shows: markdown syntax stripped (EC15). */
	text: string;
	/**
	 * Whether the operation's content has finished arriving: its string closed,
	 * or the operation object closed without one. A finished replacement that
	 * is shorter than the text it replaces hides the old tail; one still
	 * arriving cannot tell a short edit from a slow one (RS6).
	 */
	complete: boolean;
	/**
	 * The payload as sent, when it is markdown. Display text cannot be written
	 * back to the document — the syntax is what carries the block structure —
	 * so anything that commits while the call is open reads this instead.
	 */
	markdown: string | null;
}

export interface TruncatedEditDocumentRefusal {
	ok: false;
	appliedOperations: [];
	rejected: Array<{ index: number; operation: string; reason: string }>;
	outline: [];
	hint: string;
}

/**
 * Best-effort extraction of the arriving operation's content from a growing
 * `edit_document` argument JSON. Mid-stream fragments are not valid JSON
 * (Anthropic `input_json_delta`); the scanner tolerates an unterminated
 * string tail and never treats a partial as a complete payload.
 *
 * Keys are read from one element of the `operations` array rather than from the
 * payload at large: a scan over the whole text returns the *first* `blockId` it
 * finds, so every operation after the first previewed against operation one's
 * target and then snapped into place when the call closed.
 */
export function extractEditDocumentPreview(
	json: string,
	toolCallId: string,
): EditDocumentPreviewUpdate | null {
	const fragments = readOperationFragments(json);
	const operationIndex = fragments.length - 1;
	const fragment = fragments[operationIndex];
	if (fragment == null) {
		return null;
	}
	// Ids and operation names only mean something whole: half of `"closing"` is
	// `"closi"`, which addresses no block — or worse, a different one whose id
	// it is a prefix of. Content is the opposite: a prefix of it is the point.
	const operation = extractJsonString(fragment.text, "operation", {
		terminated: true,
	});
	const namedBlockId = extractJsonString(fragment.text, "blockId", {
		terminated: true,
	});
	const listedBlockIds = extractJsonArrayStrings(fragment.text, "blockIds");
	const blockId =
		namedBlockId ??
		listedBlockIds[0] ??
		extractJsonString(fragment.text, "referenceBlockId", {
			terminated: true,
		});
	// Which key the payload came from decides whether it is markdown: only the
	// block-shaped operations take `markdown`, and `text` is already plain, so
	// formatting it would eat a leading `#` a person actually typed.
	const plainText = readJsonStringField(fragment.text, "text");
	const markdown =
		plainText == null
			? readJsonStringField(fragment.text, "markdown")
			: null;
	const content = plainText ?? markdown;
	if (content == null && blockId == null && operation == null) {
		return null;
	}
	return {
		toolCallId,
		operationIndex,
		blockId,
		blockIds:
			listedBlockIds.length > 0
				? listedBlockIds
				: namedBlockId == null
					? []
					: [namedBlockId],
		placement: readPlacement(fragment.text),
		operation,
		text:
			markdown == null
				? (content?.value ?? "")
				: toStreamingPreviewText(markdown.value),
		markdown: markdown?.value ?? null,
		complete: fragment.isClosed || content?.isTerminated === true,
	};
}

function readPlacement(fragment: string): EditDocumentPreviewPlacement | null {
	const placement = extractJsonString(fragment, "placement", {
		terminated: true,
	});
	return placement === "before" || placement === "after" ? placement : null;
}

/**
 * The raw text of each element of the `operations` array, including a trailing
 * element that has not closed yet. Brace depth is what delimits an element;
 * a bracket inside one (`blockIds`) is depth-guarded, and a brace inside a
 * string (markdown content) is skipped with the string.
 */
function readOperationFragments(json: string): OperationFragment[] {
	const keyIndex = indexOfJsonKey(json, "operations");
	if (keyIndex < 0) {
		return [];
	}
	const arrayStart = json.indexOf("[", keyIndex);
	if (arrayStart < 0) {
		return [];
	}
	const fragments: OperationFragment[] = [];
	let depth = 0;
	let elementStart = -1;
	let isInString = false;
	for (let index = arrayStart + 1; index < json.length; index += 1) {
		const character = json[index]!;
		if (isInString) {
			if (character === "\\") {
				index += 1;
				continue;
			}
			if (character === '"') {
				isInString = false;
			}
			continue;
		}
		if (character === '"') {
			isInString = true;
			continue;
		}
		if (character === "{") {
			if (depth === 0) {
				elementStart = index;
			}
			depth += 1;
			continue;
		}
		if (character === "}") {
			depth -= 1;
			if (depth === 0 && elementStart >= 0) {
				fragments.push({
					text: json.slice(elementStart, index + 1),
					isClosed: true,
				});
				elementStart = -1;
			}
			continue;
		}
		if (character === "]" && depth === 0) {
			break;
		}
	}
	if (depth > 0 && elementStart >= 0) {
		fragments.push({ text: json.slice(elementStart), isClosed: false });
	}
	return fragments;
}

interface OperationFragment {
	text: string;
	/** The element's closing brace arrived: nothing more of it is coming. */
	isClosed: boolean;
}

export function createEditDocumentPreview(
	onUpdate: (update: EditDocumentPreviewUpdate | null) => void,
) {
	let json = "";
	let toolCallId = "";
	let last: EditDocumentPreviewUpdate | null = null;

	const publish = (next: EditDocumentPreviewUpdate | null): void => {
		if (isSamePreviewUpdate(last, next)) {
			return;
		}
		last = next;
		onUpdate(next);
	};

	return {
		start(nextToolCallId: string): void {
			toolCallId = nextToolCallId;
			json = "";
			publish(null);
		},
		append(delta: string): void {
			if (toolCallId.length === 0) {
				return;
			}
			json += delta;
			const next = extractEditDocumentPreview(json, toolCallId);
			if (next) {
				publish(next);
			}
		},
		withdraw(): void {
			toolCallId = "";
			json = "";
			publish(null);
		},
		get snapshot(): EditDocumentPreviewUpdate | null {
			return last;
		},
	};
}

function isSamePreviewUpdate(
	last: EditDocumentPreviewUpdate | null,
	next: EditDocumentPreviewUpdate | null,
): boolean {
	if (last == null || next == null) {
		return last === next;
	}
	return (
		PREVIEW_UPDATE_SCALAR_FIELDS.every(
			(field) => last[field] === next[field],
		) && last.blockIds.join("\0") === next.blockIds.join("\0")
	);
}

/**
 * Every field a subscriber reads. `markdown` is here as well as `text`:
 * stripping can map two payloads onto one display string (a `**` that has
 * only opened, say), and whoever writes the payload has to see the
 * difference even when the reader cannot.
 */
const PREVIEW_UPDATE_SCALAR_FIELDS = [
	"toolCallId",
	"operationIndex",
	"blockId",
	"placement",
	"operation",
	"text",
	"markdown",
	"complete",
] as const satisfies readonly (keyof EditDocumentPreviewUpdate)[];

export function isTruncatedEditDocumentInput(input: unknown): boolean {
	return (
		input != null &&
		typeof input === "object" &&
		!Array.isArray(input) &&
		(input as { [TRUNCATED_EDIT_DOCUMENT_MARKER]?: unknown })[
			TRUNCATED_EDIT_DOCUMENT_MARKER
		] === true
	);
}

export function truncatedEditDocumentRefusal(
	reason = "Tool input was truncated (max_tokens); the argument JSON did not parse. Nothing was applied.",
): TruncatedEditDocumentRefusal {
	return {
		ok: false,
		appliedOperations: [],
		rejected: [
			{
				index: 0,
				operation: "edit_document",
				reason,
			},
		],
		outline: [],
		hint: reason,
	};
}

function extractJsonString(
	json: string,
	key: string,
	options?: { terminated?: boolean },
): string | null {
	const keyIndex = indexOfJsonKey(json, key);
	if (keyIndex < 0) {
		return null;
	}
	const colon = json.indexOf(":", keyIndex);
	if (colon < 0) {
		return null;
	}
	let index = colon + 1;
	while (index < json.length && isJsonWhitespace(json[index]!)) {
		index += 1;
	}
	if (json[index] !== '"') {
		return null;
	}
	return readJsonStringValue(json, index + 1, options);
}

/** A string value and whether its closing quote arrived. */
function readJsonStringField(
	json: string,
	key: string,
): { value: string; isTerminated: boolean } | null {
	const keyIndex = indexOfJsonKey(json, key);
	if (keyIndex < 0) {
		return null;
	}
	const colon = json.indexOf(":", keyIndex);
	if (colon < 0) {
		return null;
	}
	const index = skipJsonWhitespace(json, colon + 1);
	if (json[index] !== '"') {
		return null;
	}
	return readJsonString(json, index + 1);
}

/**
 * The strings of an array value, in order, stopping at the first one whose
 * closing quote has not arrived: an id in a list is an id, so a half-arrived
 * one is held back like any other.
 */
function extractJsonArrayStrings(json: string, key: string): string[] {
	const keyIndex = indexOfJsonKey(json, key);
	if (keyIndex < 0) {
		return [];
	}
	const colon = json.indexOf(":", keyIndex);
	const open = colon < 0 ? -1 : json.indexOf("[", colon);
	if (open < 0) {
		return [];
	}
	const values: string[] = [];
	let index = skipJsonWhitespace(json, open + 1);
	while (json[index] === '"') {
		const read = readJsonString(json, index + 1);
		if (!read.isTerminated) {
			break;
		}
		values.push(read.value);
		index = skipJsonWhitespace(json, read.end + 1);
		if (json[index] !== ",") {
			break;
		}
		index = skipJsonWhitespace(json, index + 1);
	}
	return values;
}

function skipJsonWhitespace(json: string, from: number): number {
	let index = from;
	while (index < json.length && isJsonWhitespace(json[index]!)) {
		index += 1;
	}
	return index;
}

function readJsonStringValue(
	json: string,
	start: number,
	options?: { terminated?: boolean },
): string | null {
	const read = readJsonString(json, start);
	if (options?.terminated === true && !read.isTerminated) {
		return null;
	}
	return read.value;
}

function indexOfJsonKey(json: string, key: string): number {
	const needle = `"${key}"`;
	let from = 0;
	while (from < json.length) {
		const index = json.indexOf(needle, from);
		if (index < 0) {
			return -1;
		}
		if (!isLikelyInsideString(json, index)) {
			return index;
		}
		from = index + needle.length;
	}
	return -1;
}

const JSON_UNICODE_ESCAPE_LENGTH = 4;
const HEX_QUAD_PATTERN = /^[0-9a-fA-F]{4}$/;

/**
 * Reads a JSON string body that may stop mid-character, and says whether its
 * closing quote arrived — the difference between a value and a prefix of one.
 *
 * An escape that has not finished arriving is dropped rather than decoded:
 * emitting the `u` of a half-sent `\u2014` would put a literal `u2014` on
 * screen and — since EC20 writes this text — into the document. Stopping short
 * costs one frame of a character that is about to arrive anyway.
 */
function readJsonString(
	json: string,
	start: number,
): { value: string; isTerminated: boolean; end: number } {
	let output = "";
	for (let index = start; index < json.length; index += 1) {
		const character = json[index]!;
		if (character === "\\") {
			const escaped = json[index + 1];
			if (escaped == null) {
				return { value: output, isTerminated: false, end: json.length };
			}
			if (escaped === "u") {
				const hexStart = index + 2;
				const hex = json.slice(
					hexStart,
					hexStart + JSON_UNICODE_ESCAPE_LENGTH,
				);
				if (!HEX_QUAD_PATTERN.test(hex)) {
					return {
						value: output,
						isTerminated: false,
						end: json.length,
					};
				}
				output += String.fromCharCode(Number.parseInt(hex, 16));
				index = hexStart + JSON_UNICODE_ESCAPE_LENGTH - 1;
				continue;
			}
			output += unescapeJson(escaped);
			index += 1;
			continue;
		}
		if (character === '"') {
			return { value: output, isTerminated: true, end: index };
		}
		output += character;
	}
	return { value: output, isTerminated: false, end: json.length };
}

function unescapeJson(escaped: string): string {
	switch (escaped) {
		case "n":
			return "\n";
		case "r":
			return "\r";
		case "t":
			return "\t";
		case "b":
			return "\b";
		case "f":
			return "\f";
		case '"':
		case "\\":
		case "/":
			return escaped;
		default:
			return escaped;
	}
}

function isJsonWhitespace(character: string): boolean {
	return (
		character === " " ||
		character === "\t" ||
		character === "\n" ||
		character === "\r"
	);
}

function isLikelyInsideString(json: string, index: number): boolean {
	let inString = false;
	for (let cursor = 0; cursor < index; cursor += 1) {
		const character = json[cursor]!;
		if (character === "\\" && inString) {
			cursor += 1;
			continue;
		}
		if (character === '"') {
			inString = !inString;
		}
	}
	return inString;
}
