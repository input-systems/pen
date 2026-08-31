import { buildDocumentWriteOps } from "@input/pen-ingest";
import { convertBlockOps, supportsInlineMarks } from "@input/pen-core";
import type {
	ApplyOptions,
	DocumentOp,
	Editor,
	InlineSchema,
	ToolDefinition,
} from "@input/pen-types";
import { checkToolCanUseBlockType } from "../utils/blockTypePolicy";
import {
	resolveDocumentBlocks,
	summarizeBlocks,
} from "../utils/documentContext";
import { checkToolCanMutateBlock } from "../utils/mutationPolicy";
import { validateToolPayloads } from "../utils/payloadValidation";

/**
 * `edit_document` — the EC1 edit channel.
 *
 * Every operation addresses its target by block id (EC2). Content stays
 * markdown (EC3); marks and props travel structured because markdown cannot
 * carry them (EC18). The set is closed (EC4). Nothing here throws: a
 * rejected operation is a returned result the model can read and retry
 * against (EC5), and a payload that cannot be understood never becomes
 * document content (EC6). Hosts that need a different apply origin or a
 * wrapper around `editor.apply` use {@link executeEditDocument} or
 * {@link editDocumentTool} with {@link ExecuteEditDocumentOptions} rather
 * than compiling operations themselves (EC21).
 *
 * Spec: `spec/packages/extensions/ai.md`.
 */

/** Closed `edit_document` operation names (EC4). */
export const EDIT_DOCUMENT_OPERATIONS = [
	"replace_block_text",
	"replace_blocks",
	"insert_blocks",
	"delete_blocks",
	"move_block",
	"format_text",
	"set_block_props",
] as const;

/** One member of {@link EDIT_DOCUMENT_OPERATIONS}. */
export type EditDocumentOperation = (typeof EDIT_DOCUMENT_OPERATIONS)[number];

/**
 * One operation in an `edit_document` envelope. The planner reads these
 * fields from untrusted input; extra keys are ignored (EC2).
 */
export interface EditDocumentOperationInput {
	operation?: unknown;
	blockId?: unknown;
	blockIds?: unknown;
	referenceBlockId?: unknown;
	text?: unknown;
	markdown?: unknown;
	placement?: unknown;
	matchText?: unknown;
	occurrence?: unknown;
	marks?: unknown;
	blockType?: unknown;
	props?: unknown;
}

/** One block's public handle, as handed back to the model on a refusal (EC5). */
export interface EditDocumentOutlineEntry {
	blockId: string;
	blockType: string;
	preview: string;
}

/** One semantic refusal inside an {@link EditDocumentResult} (EC5). */
export interface EditDocumentRejection {
	index: number;
	operation: string;
	reason: string;
}

/** Result of {@link executeEditDocument} and the `edit_document` tool handler. */
export interface EditDocumentResult {
	ok: boolean;
	appliedOperations: string[];
	rejected?: EditDocumentRejection[];
	outline?: EditDocumentOutlineEntry[];
	hint?: string;
}

/** One compiled {@link DocumentOp} and the envelope operation that produced it. */
export interface EditDocumentCompiledOp {
	index: number;
	operation: string;
	op: DocumentOp;
}

/**
 * Compiled `edit_document` operations, before payload validation or apply.
 * Planning does not write: {@link compiledOperations} names operations that
 * produced ops, not operations that landed (EC21).
 */
export interface EditDocumentPlan {
	/** Flattened compiled ops, same order as {@link compiled}. */
	ops: DocumentOp[];
	/** Compiled ops tagged with the envelope index they belong to. */
	compiled: EditDocumentCompiledOp[];
	/** Operation names that compiled successfully, in envelope order. */
	compiledOperations: string[];
	rejected: EditDocumentRejection[];
}

/**
 * Host options for {@link executeEditDocument} and {@link editDocumentTool}.
 * The injected `apply` must still land through `editor.apply` (EC13).
 */
export interface ExecuteEditDocumentOptions {
	/**
	 * Apply origin. Default `"ai"`. Passed through to `apply` as
	 * `applyOptions.origin`.
	 */
	origin?: ApplyOptions["origin"];
	/**
	 * Host write path. Default calls `editor.apply(ops, applyOptions)`.
	 * Must not map results; {@link executeEditDocument} observes the apply
	 * boundary and merges applied/rejected itself (EC5, EC21).
	 */
	apply?: (ops: DocumentOp[], applyOptions: ApplyOptions) => void;
}

/**
 * Compile an `edit_document` envelope into {@link DocumentOp}s without applying.
 *
 * @param editor - Live editor used for target lookup, schema checks, and markdown compile.
 * @param input - Tool envelope `{ operations: [...] }`. Extra keys are ignored (EC2).
 * @returns A plan: compiled ops with envelope ownership, compiled operation names, and semantic refusals.
 * @throws Never. Semantic failures are {@link EditDocumentPlan.rejected} (EC5).
 */
export function planEditDocument(
	editor: Editor,
	input: unknown,
): EditDocumentPlan {
	const requests = readRequests(input);
	if (requests.length === 0) {
		return emptyPlan([
			{
				index: 0,
				operation: "(none)",
				reason: "no-operations: expected a non-empty `operations` array.",
			},
		]);
	}

	const compiled: EditDocumentCompiledOp[] = [];
	const rejected: EditDocumentRejection[] = [];
	const compiledOperations: string[] = [];

	for (const [index, request] of requests.entries()) {
		const built = buildEditOps(editor, request);
		if (!built.ok) {
			rejected.push({
				index,
				operation: String(request.operation ?? "(missing)"),
				reason: built.reason,
			});
			continue;
		}
		const operation = String(request.operation);
		compiledOperations.push(operation);
		for (const op of built.ops) {
			compiled.push({ index, operation, op });
		}
	}

	return {
		ops: compiled.map((entry) => entry.op),
		compiled,
		compiledOperations,
		rejected,
	};
}

/**
 * Plan, batch-validate, and apply an `edit_document` envelope.
 *
 * Writes go through `editor.apply` (EC13). The executor observes
 * `onApplyBoundary` and only lists an operation as applied when every
 * compiled op for that envelope index landed. Hosts that need a different
 * origin or persistence wrapper inject {@link ExecuteEditDocumentOptions.apply};
 * they do not remap results (EC5, EC21).
 *
 * @param editor - Live editor. Durable writes use its apply pipeline.
 * @param input - Tool envelope `{ operations: [...] }`.
 * @param options - Optional apply origin and write wrapper.
 * @param options.origin - Apply origin. Default `"ai"`.
 * @param options.apply - Host write path. Default `editor.apply(ops, applyOptions)`.
 * @returns Result naming operations that landed and refusals. `ok` is true only when every operation applied.
 * @throws If {@link ExecuteEditDocumentOptions.apply} throws. Semantic refusals and batch payload validation do not throw (EC5).
 */
export function executeEditDocument(
	editor: Editor,
	input: unknown,
	options?: ExecuteEditDocumentOptions,
): EditDocumentResult {
	const plan = planEditDocument(editor, input);
	if (plan.rejected[0]?.operation === "(none)") {
		return {
			ok: false,
			appliedOperations: [],
			rejected: plan.rejected,
			outline: buildOutline(editor),
			hint: "Nothing was applied.",
		};
	}

	const validation = validateToolPayloads(editor, plan.ops);
	if (!validation.ok) {
		return {
			ok: false,
			appliedOperations: [],
			rejected: [
				...plan.rejected,
				{
					index: -1,
					operation: "(batch)",
					reason: `invalid-payload: ${validation.failures
						.map((failure) => failure.message)
						.join("; ")}`,
				},
			],
			outline: buildOutline(editor),
			hint: "Nothing was applied.",
		};
	}

	const applyOutcome =
		validation.ops.length > 0
			? applyEditDocumentOps(
					editor,
					validation.ops,
					plan.compiled,
					options,
				)
			: { appliedIndexes: [], rejected: [] };

	return mergeEditDocumentResult(editor, plan, applyOutcome);
}

/**
 * Built-in `edit_document` tool. `toolsExtension()` registers it with the
 * default apply path (`origin: "ai"`).
 *
 * @param editor - Editor the tool reads and writes.
 * @param options - Same as {@link executeEditDocument}. `origin` defaults to `"ai"`; `apply` defaults to `editor.apply`.
 * @returns A mutating, destructive {@link ToolDefinition} whose handler calls {@link executeEditDocument}.
 * @throws Never from the factory. The handler rejects or throws if {@link ExecuteEditDocumentOptions.apply} throws. Semantic refusals do not throw (EC5).
 */
export function editDocumentTool(
	editor: Editor,
	options?: ExecuteEditDocumentOptions,
): ToolDefinition {
	return {
		name: "edit_document",
		description:
			"Edit the document. Every operation names the block ids it targets — get them from read_document with annotateBlocks. Operations: replace_block_text (new plain text for one block, keeping its type and identity), replace_blocks (one or more blocks become the given markdown — use this to change a block's type when identity need not be kept, e.g. paragraph to bullet list), insert_blocks (markdown placed before or after a block), delete_blocks, move_block, format_text (apply or clear marks over an exact text match inside a named block), set_block_props (change blockType and/or props in place, keeping the id). Send every part of a multi-part request as separate operations in one call. If an operation is rejected the result says why and lists the document's current blocks; fix the ids and call again.",
		mutating: true,
		destructive: true,
		inputSchema: {
			type: "object",
			required: ["operations"],
			properties: {
				operations: {
					type: "array",
					items: {
						type: "object",
						required: ["operation"],
						properties: {
							operation: {
								type: "string",
								enum: [...EDIT_DOCUMENT_OPERATIONS],
							},
							blockId: {
								type: "string",
								description:
									"Target block id, for single-target operations.",
							},
							blockIds: {
								type: "array",
								items: { type: "string" },
								description:
									"Target block ids, for replace_blocks and delete_blocks.",
							},
							referenceBlockId: {
								type: "string",
								description:
									"The block that move_block moves relative to.",
							},
							text: {
								type: "string",
								description:
									"Plain text, for replace_block_text. Never HTML.",
							},
							markdown: {
								type: "string",
								description:
									"Markdown content, for replace_blocks and insert_blocks. Never HTML.",
							},
							placement: {
								type: "string",
								enum: ["before", "after"],
								description:
									"Where insert_blocks and move_block land, relative to the target. Defaults to after.",
							},
							matchText: {
								type: "string",
								description:
									"Exact text to format inside the target block. Omit to format the whole block. If the text occurs more than once, pass occurrence.",
							},
							occurrence: {
								type: "number",
								minimum: 1,
								description:
									"Which match to format, 1-based, when matchText occurs more than once.",
							},
							marks: {
								type: "object",
								additionalProperties: true,
								minProperties: 1,
								description: describeLiveMarks(editor),
							},
							blockType: {
								type: "string",
								description:
									"New type for set_block_props. Identity is preserved.",
							},
							props: {
								type: "object",
								additionalProperties: true,
								minProperties: 1,
								description:
									"Prop name to value for set_block_props, or null to clear a prop. At least one of blockType or props is required.",
							},
						},
					},
				},
			},
		},
		handler: async (input: unknown): Promise<EditDocumentResult> => {
			return executeEditDocument(editor, input, options);
		},
	};
}

const DROPPED_APPLY_REASON =
	"dropped-apply: the mutation was filtered before write.";

/**
 * Enumerable own symbol so `{ ...op }` and apply-pipeline snapshots keep the
 * unique owner token. Duplicate compiled ops never alias.
 */
const EDIT_DOCUMENT_OWNER = Symbol("pen.editDocument.owner");

interface EditDocumentApplyOutcome {
	appliedIndexes: number[];
	rejected: EditDocumentRejection[];
}

interface OwnedCompiledOp {
	index: number;
	operation: string;
	token: symbol;
}

function emptyPlan(rejected: EditDocumentRejection[]): EditDocumentPlan {
	return {
		ops: [],
		compiled: [],
		compiledOperations: [],
		rejected,
	};
}

function applyEditDocumentOps(
	editor: Editor,
	validatedOps: readonly DocumentOp[],
	compiled: readonly EditDocumentCompiledOp[],
	options: ExecuteEditDocumentOptions | undefined,
): EditDocumentApplyOutcome {
	const owned: OwnedCompiledOp[] = [];
	const payload = validatedOps.map((op, i) => {
		const entry = compiled[i];
		const token = Symbol();
		if (entry) {
			owned.push({
				index: entry.index,
				operation: entry.operation,
				token,
			});
		}
		return stampOwner(op, token);
	});

	const applyOptions: ApplyOptions = {
		origin: options?.origin ?? "ai",
	};
	const apply =
		options?.apply ??
		((nextOps, nextOptions) => editor.apply(nextOps, nextOptions));

	const ownedTokens = new Set(owned.map((entry) => entry.token));
	const transformedCounts = new Map<symbol, number>();
	const appliedCounts = new Map<symbol, number>();
	const unsubscribe = editor.internals.onApplyBoundary((event) => {
		if (event.phase === "after" && !event.applied) {
			return;
		}
		const counts =
			event.phase === "before" ? transformedCounts : appliedCounts;
		for (const op of event.ops) {
			const token = readOwner(op);
			if (token !== undefined && ownedTokens.has(token)) {
				counts.set(token, (counts.get(token) ?? 0) + 1);
			}
		}
	});

	try {
		apply(payload, applyOptions);
	} finally {
		unsubscribe();
	}

	return mapOwnedOutcome(owned, transformedCounts, appliedCounts);
}

function stampOwner(op: DocumentOp, token: symbol): DocumentOp {
	return Object.defineProperty({ ...op }, EDIT_DOCUMENT_OWNER, {
		value: token,
		enumerable: true,
		configurable: true,
		writable: true,
	}) as DocumentOp;
}

function readOwner(op: unknown): symbol | undefined {
	if (op === null || typeof op !== "object") {
		return undefined;
	}
	const token = (op as unknown as Record<symbol, unknown>)[
		EDIT_DOCUMENT_OWNER
	];
	return typeof token === "symbol" ? token : undefined;
}

function mapOwnedOutcome(
	owned: readonly OwnedCompiledOp[],
	transformedCounts: ReadonlyMap<symbol, number>,
	appliedCounts: ReadonlyMap<symbol, number>,
): EditDocumentApplyOutcome {
	const appliedIndexes: number[] = [];
	const rejected: EditDocumentRejection[] = [];
	const seen = new Set<number>();

	for (const entry of owned) {
		if (seen.has(entry.index)) {
			continue;
		}
		seen.add(entry.index);
		const tokens = owned
			.filter((candidate) => candidate.index === entry.index)
			.map((candidate) => candidate.token);
		const didApplyEveryTransform = tokens.every((token) => {
			const transformedCount = transformedCounts.get(token) ?? 0;
			return (
				transformedCount > 0 &&
				appliedCounts.get(token) === transformedCount
			);
		});
		if (didApplyEveryTransform) {
			appliedIndexes.push(entry.index);
			continue;
		}
		rejected.push({
			index: entry.index,
			operation: entry.operation,
			reason: DROPPED_APPLY_REASON,
		});
	}

	return { appliedIndexes, rejected };
}

function mergeEditDocumentResult(
	editor: Editor,
	plan: EditDocumentPlan,
	applyOutcome: EditDocumentApplyOutcome,
): EditDocumentResult {
	const appliedIndexes = new Set(applyOutcome.appliedIndexes);
	const appliedOperations: string[] = [];
	const seen = new Set<number>();
	for (const entry of plan.compiled) {
		if (seen.has(entry.index) || !appliedIndexes.has(entry.index)) {
			continue;
		}
		seen.add(entry.index);
		appliedOperations.push(entry.operation);
	}
	const rejected = [...plan.rejected, ...applyOutcome.rejected];

	if (rejected.length > 0) {
		return {
			ok: false,
			appliedOperations,
			rejected,
			outline: buildOutline(editor),
			hint:
				appliedOperations.length === 0
					? "Nothing was applied."
					: "The rejected operations were not applied; the others were. Retry only the rejected ones, using the ids in `outline`.",
		};
	}

	return { ok: true, appliedOperations };
}

function readRequests(input: unknown): EditDocumentOperationInput[] {
	const operations = (input as { operations?: unknown } | null)?.operations;
	return Array.isArray(operations)
		? (operations as EditDocumentOperationInput[])
		: [];
}

type BuildResult =
	{ ok: true; ops: DocumentOp[] } | { ok: false; reason: string };

function buildEditOps(
	editor: Editor,
	request: EditDocumentOperationInput,
): BuildResult {
	const operation = request.operation;
	if (!isEditOperation(operation)) {
		return {
			ok: false,
			reason: `unknown-operation: "${String(operation)}" is not one of ${EDIT_DOCUMENT_OPERATIONS.join(", ")}.`,
		};
	}

	switch (operation) {
		case "replace_block_text":
			return buildReplaceBlockText(editor, request);
		case "replace_blocks":
			return buildReplaceBlocks(editor, request);
		case "insert_blocks":
			return buildInsertBlocks(editor, request);
		case "delete_blocks":
			return buildDeleteBlocks(editor, request);
		case "move_block":
			return buildMoveBlock(editor, request);
		case "format_text":
			return buildFormatText(editor, request);
		case "set_block_props":
			return buildSetBlockProps(editor, request);
		default: {
			const unhandled: never = operation;
			return {
				ok: false,
				reason: `unknown-operation: ${String(unhandled)}`,
			};
		}
	}
}

function buildReplaceBlockText(
	editor: Editor,
	request: EditDocumentOperationInput,
): BuildResult {
	const target = resolveOneBlock(editor, request.blockId);
	if (!target.ok) {
		return target;
	}
	if (typeof request.text !== "string") {
		return {
			ok: false,
			reason: "missing-text: replace_block_text needs a `text` string.",
		};
	}
	const htmlRefusal = refuseHtmlPayload(request.text);
	if (htmlRefusal) {
		return htmlRefusal;
	}
	const block = editor.getBlock(target.blockId);
	return {
		ok: true,
		ops: [
			{
				type: "splice-text",
				blockId: target.blockId,
				from: 0,
				to: block?.length() ?? 0,
				insert: request.text,
			},
		],
	};
}

function buildReplaceBlocks(
	editor: Editor,
	request: EditDocumentOperationInput,
): BuildResult {
	const targets = resolveBlockList(editor, request);
	if (!targets.ok) {
		return targets;
	}
	const written = writeMarkdown(editor, request.markdown, "replace_blocks", {
		before: targets.blockIds[0]!,
	});
	if (!written.ok) {
		return written;
	}
	return {
		ok: true,
		ops: [
			...written.ops,
			...targets.blockIds.map(
				(blockId) =>
					({ type: "delete-block", blockId }) satisfies DocumentOp,
			),
		],
	};
}

function buildInsertBlocks(
	editor: Editor,
	request: EditDocumentOperationInput,
): BuildResult {
	const target = resolveOneBlock(editor, request.blockId);
	if (!target.ok) {
		return target;
	}
	const position =
		request.placement === "before"
			? { before: target.blockId }
			: { after: target.blockId };
	return writeMarkdown(editor, request.markdown, "insert_blocks", position);
}

function buildDeleteBlocks(
	editor: Editor,
	request: EditDocumentOperationInput,
): BuildResult {
	const targets = resolveBlockList(editor, request);
	if (!targets.ok) {
		return targets;
	}
	return {
		ok: true,
		ops: targets.blockIds.map(
			(blockId) =>
				({ type: "delete-block", blockId }) satisfies DocumentOp,
		),
	};
}

function buildMoveBlock(
	editor: Editor,
	request: EditDocumentOperationInput,
): BuildResult {
	const target = resolveOneBlock(editor, request.blockId);
	if (!target.ok) {
		return target;
	}
	const reference = resolveOneBlock(editor, request.referenceBlockId);
	if (!reference.ok) {
		return {
			ok: false,
			reason: `${reference.reason} move_block needs \`referenceBlockId\`.`,
		};
	}
	if (reference.blockId === target.blockId) {
		return {
			ok: false,
			reason: "invalid-target: move_block cannot move a block relative to itself.",
		};
	}
	const position =
		request.placement === "before"
			? { before: reference.blockId }
			: { after: reference.blockId };
	return {
		ok: true,
		ops: [{ type: "move-block", blockId: target.blockId, position }],
	};
}

function buildFormatText(
	editor: Editor,
	request: EditDocumentOperationInput,
): BuildResult {
	const target = resolveOneBlock(editor, request.blockId);
	if (!target.ok) {
		return target;
	}
	const block = editor.getBlock(target.blockId);
	if (!block) {
		return {
			ok: false,
			reason: `unknown-block: Unknown block: "${target.blockId}"`,
		};
	}
	const blockSchema = editor.schema.resolve(block.type);
	if (!supportsInlineMarks(blockSchema)) {
		return {
			ok: false,
			reason: `mark-not-allowed: block "${target.blockId}" of type "${block.type}" does not accept inline marks.`,
		};
	}

	const marksResult = readMarks(editor, request.marks);
	if (!marksResult.ok) {
		return marksResult;
	}

	const range = resolveFormatRange(block.textContent(), request);
	if (!range.ok) {
		return range;
	}

	return {
		ok: true,
		ops: [
			{
				type: "format-text",
				blockId: target.blockId,
				from: range.from,
				to: range.to,
				marks: marksResult.marks,
			},
		],
	};
}

function buildSetBlockProps(
	editor: Editor,
	request: EditDocumentOperationInput,
): BuildResult {
	const target = resolveOneBlock(editor, request.blockId);
	if (!target.ok) {
		return target;
	}
	const block = editor.getBlock(target.blockId);
	if (!block) {
		return {
			ok: false,
			reason: `unknown-block: Unknown block: "${target.blockId}"`,
		};
	}

	const blockType =
		request.blockType === undefined ? undefined : request.blockType;
	if (blockType !== undefined && typeof blockType !== "string") {
		return {
			ok: false,
			reason: "invalid-block-type: set_block_props `blockType` must be a string.",
		};
	}
	if (typeof blockType === "string") {
		const typeReason = checkToolCanUseBlockType(editor, blockType);
		if (typeReason) {
			return {
				ok: false,
				reason: `block-type-not-allowed: ${typeReason}`,
			};
		}
	}

	const hasProps = request.props !== undefined;
	if (blockType === undefined && !hasProps) {
		return {
			ok: false,
			reason: "missing-change: set_block_props needs `blockType` and/or a non-empty `props` record.",
		};
	}

	let props: Record<string, unknown | null> | undefined;
	if (hasProps) {
		if (
			typeof request.props !== "object" ||
			request.props === null ||
			Array.isArray(request.props)
		) {
			return {
				ok: false,
				reason: "invalid-props: set_block_props `props` must be an object.",
			};
		}
		props = request.props as Record<string, unknown | null>;
		if (Object.keys(props).length === 0 && blockType === undefined) {
			return {
				ok: false,
				reason: "missing-change: set_block_props needs `blockType` and/or a non-empty `props` record.",
			};
		}
	}

	const targetType = typeof blockType === "string" ? blockType : block.type;
	if (props) {
		const propReason = checkPropsForType(editor, targetType, props);
		if (propReason) {
			return { ok: false, reason: propReason };
		}
	}

	if (typeof blockType === "string") {
		return {
			ok: true,
			ops: convertBlockOps(editor, {
				blockId: target.blockId,
				newType: blockType,
				...(props ? { newProps: props } : {}),
			}),
		};
	}

	return {
		ok: true,
		ops: [
			{
				type: "set-props",
				blockId: target.blockId,
				props: props ?? {},
			},
		],
	};
}

function readMarks(
	editor: Editor,
	raw: unknown,
):
	| { ok: true; marks: Record<string, unknown | null> }
	| { ok: false; reason: string } {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return {
			ok: false,
			reason: "missing-marks: format_text needs a non-empty `marks` record.",
		};
	}
	const entries = Object.entries(raw as Record<string, unknown>);
	if (entries.length === 0) {
		return {
			ok: false,
			reason: "missing-marks: format_text needs a non-empty `marks` record.",
		};
	}

	const marks: Record<string, unknown | null> = {};
	for (const [name, value] of entries) {
		const markSchema = resolveMarkSchema(editor, name);
		if (!markSchema) {
			return {
				ok: false,
				reason: `unknown-mark: "${name}" is not a mark in the live schema.`,
			};
		}
		if (value === null) {
			marks[name] = null;
			continue;
		}
		if (typeof value !== "object" || Array.isArray(value)) {
			return {
				ok: false,
				reason: `invalid-marks: mark "${name}" must be a props object or null.`,
			};
		}
		const props = value as Record<string, unknown>;
		const unknownKeys = Object.keys(props).filter(
			(key) =>
				!Object.prototype.hasOwnProperty.call(
					markSchema.propSchema ?? {},
					key,
				),
		);
		if (unknownKeys.length > 0) {
			return {
				ok: false,
				reason: `unknown-mark-prop: mark "${name}" has no prop ${unknownKeys
					.map((key) => `"${key}"`)
					.join(", ")}.`,
			};
		}
		marks[name] = markApplyValue(markSchema, props);
	}
	return { ok: true, marks };
}

function resolveMarkSchema(editor: Editor, name: string): InlineSchema | null {
	const inline = editor.schema.resolveInline(name);
	if (!inline || inline.kind !== "mark") {
		return null;
	}
	return inline;
}

function describeLiveMarks(editor: Editor): string {
	const listed = editor.schema
		.allInlines()
		.filter((inline) => inline.kind === "mark" && !inline.system)
		.map((mark) => {
			const props = Object.keys(mark.propSchema ?? {});
			const propPart =
				props.length > 0 ? `; props: ${props.join(", ")}` : "";
			return mark.aiDescription
				? `${mark.type} (${mark.aiDescription}${propPart})`
				: props.length > 0
					? `${mark.type} (props: ${props.join(", ")})`
					: mark.type;
		});
	if (listed.length === 0) {
		return "Mark name to props object, or null to clear. Required and non-empty for format_text.";
	}
	return `Mark name to props object, or null to clear. Required and non-empty for format_text. Available marks: ${listed.join("; ")}.`;
}

function refuseHtmlPayload(payload: string): BuildResult | null {
	if (!payloadContainsHtmlElement(payload)) {
		return null;
	}
	return {
		ok: false,
		reason: "html-in-payload: payloads are plain text/markdown, not HTML; use format_text with marks for styling",
	};
}

/**
 * Detects HTML element syntax in a text/markdown payload.
 * Strips fenced and inline code first so literals like `` `<span>` `` and
 * comparisons like `a < b` stay legal. Deliberately does not catch
 * autolinks (`<https://...>`), HTML comments, entities, or unknown tag
 * names that carry no attributes.
 */
function payloadContainsHtmlElement(payload: string): boolean {
	const outsideCode = payload
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`]*`/g, "");
	return (
		/<\/?(?:span|font|strong|em|b|i|u|s|mark|strike|del|ins|small|big|sub|sup|style|div|p|br|img|a|code|pre|h[1-6]|table|thead|tbody|tr|td|th)(?:\s[^>]*)?\/?>/i.test(
			outsideCode,
		) || /<\/?[a-zA-Z][a-zA-Z0-9]*\s[^>]*>/.test(outsideCode)
	);
}

function markApplyValue(
	schema: InlineSchema,
	props: Record<string, unknown>,
): unknown {
	if (Object.keys(schema.propSchema ?? {}).length === 0) {
		return Object.keys(props).length === 0 ? true : props;
	}
	return props;
}

function resolveFormatRange(
	text: string,
	request: EditDocumentOperationInput,
): { ok: true; from: number; to: number } | { ok: false; reason: string } {
	if (request.matchText === undefined || request.matchText === null) {
		if (request.occurrence !== undefined) {
			return {
				ok: false,
				reason: "invalid-occurrence: occurrence is only valid with matchText.",
			};
		}
		return { ok: true, from: 0, to: text.length };
	}
	if (
		typeof request.matchText !== "string" ||
		request.matchText.length === 0
	) {
		return {
			ok: false,
			reason: "missing-match: format_text `matchText` must be a non-empty string.",
		};
	}

	const starts = findMatchStarts(text, request.matchText);
	if (starts.length === 0) {
		return {
			ok: false,
			reason: `match-not-found: ${JSON.stringify(request.matchText)} does not occur in the block.`,
		};
	}

	const occurrence = request.occurrence;
	if (occurrence === undefined) {
		if (starts.length > 1) {
			return {
				ok: false,
				reason: `ambiguous-match: ${JSON.stringify(request.matchText)} occurs ${starts.length} times; pass occurrence (1-based).`,
			};
		}
		const start = starts[0]!;
		return {
			ok: true,
			from: start,
			to: start + request.matchText.length,
		};
	}

	if (
		typeof occurrence !== "number" ||
		!Number.isInteger(occurrence) ||
		occurrence < 1 ||
		occurrence > starts.length
	) {
		return {
			ok: false,
			reason: `occurrence-out-of-range: ${JSON.stringify(request.matchText)} occurs ${starts.length} times; occurrence ${String(occurrence)} is not in 1..${starts.length}.`,
		};
	}

	const start = starts[occurrence - 1]!;
	return {
		ok: true,
		from: start,
		to: start + request.matchText.length,
	};
}

function findMatchStarts(text: string, matchText: string): number[] {
	const starts: number[] = [];
	let searchFrom = 0;
	while (searchFrom <= text.length) {
		const index = text.indexOf(matchText, searchFrom);
		if (index === -1) {
			break;
		}
		starts.push(index);
		searchFrom = index + matchText.length;
	}
	return starts;
}

function checkPropsForType(
	editor: Editor,
	blockType: string,
	props: Record<string, unknown | null>,
): string | null {
	const schema = editor.schema.resolve(blockType);
	if (!schema) {
		return `block-type-not-allowed: Unknown block type: "${blockType}"`;
	}
	const allowed = schema.propSchema ?? {};
	const unknownKeys = Object.keys(props).filter(
		(key) => !Object.prototype.hasOwnProperty.call(allowed, key),
	);
	if (unknownKeys.length > 0) {
		return `unknown-prop: type "${blockType}" has no prop ${unknownKeys
			.map((key) => `"${key}"`)
			.join(", ")}.`;
	}
	return null;
}

function writeMarkdown(
	editor: Editor,
	markdown: unknown,
	operation: string,
	position: { before: string } | { after: string },
): BuildResult {
	if (typeof markdown !== "string" || markdown.trim().length === 0) {
		return {
			ok: false,
			reason: `missing-markdown: ${operation} needs a non-empty \`markdown\` string.`,
		};
	}
	const htmlRefusal = refuseHtmlPayload(markdown);
	if (htmlRefusal) {
		return htmlRefusal;
	}
	const { ops, blocks } = buildDocumentWriteOps(editor, {
		format: "markdown",
		content: markdown,
		position,
		surface: "edit-document",
	});
	if (ops.length === 0) {
		return {
			ok: false,
			reason: "unparseable-markdown: the markdown produced no blocks.",
		};
	}
	for (const block of blocks) {
		const reason = checkToolCanUseBlockType(editor, block.type);
		if (reason) {
			return { ok: false, reason: `block-type-not-allowed: ${reason}` };
		}
	}
	return { ok: true, ops };
}

type ResolveOne = { ok: true; blockId: string } | { ok: false; reason: string };

function resolveOneBlock(editor: Editor, blockId: unknown): ResolveOne {
	if (typeof blockId !== "string" || blockId.length === 0) {
		return {
			ok: false,
			reason: "missing-block-id: this operation needs a block id.",
		};
	}
	const reason = checkToolCanMutateBlock(editor, blockId);
	if (reason) {
		return { ok: false, reason: `unknown-block: ${reason}` };
	}
	return { ok: true, blockId };
}

type ResolveMany =
	{ ok: true; blockIds: string[] } | { ok: false; reason: string };

function resolveBlockList(
	editor: Editor,
	request: EditDocumentOperationInput,
): ResolveMany {
	const raw = Array.isArray(request.blockIds)
		? request.blockIds
		: typeof request.blockId === "string"
			? [request.blockId]
			: [];
	const blockIds = [
		...new Set(raw.filter((id): id is string => typeof id === "string")),
	];
	if (blockIds.length === 0) {
		return {
			ok: false,
			reason: "missing-block-id: this operation needs `blockIds` (or a single `blockId`).",
		};
	}
	const reasons = blockIds
		.map((blockId) => checkToolCanMutateBlock(editor, blockId))
		.filter((reason): reason is string => reason !== null);
	if (reasons.length > 0) {
		return { ok: false, reason: `unknown-block: ${reasons.join("; ")}` };
	}
	return { ok: true, blockIds };
}

function isEditOperation(value: unknown): value is EditDocumentOperation {
	return (
		typeof value === "string" &&
		(EDIT_DOCUMENT_OPERATIONS as readonly string[]).includes(value)
	);
}

function buildOutline(editor: Editor): EditDocumentOutlineEntry[] {
	return summarizeBlocks(resolveDocumentBlocks(editor, null, "resolved")).map(
		(block) => ({
			blockId: block.id,
			blockType: block.type,
			preview: block.preview,
		}),
	);
}
