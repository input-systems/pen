import { buildDocumentWriteOps } from "@input/pen-ingest";
import type { DocumentOp, Editor, OpOrigin } from "@input/pen-types";
import { applyAIOpsForBoundMutationMode } from "../tools/execution";
import type { EditDocumentPreviewUpdate } from "./editDocumentPreview";
import { toStreamingPreviewText } from "./streamingPreviewText";

/**
 * The only operation written before its call closes.
 *
 * A replace op targets a block that already exists, so its inline preview is
 * already in the right place and early writing would buy nothing while making
 * the target's view hash stale against the read the model was given (EC9).
 * `insert_blocks` is the case that cannot be previewed honestly as inline text:
 * its payload is several blocks, and a decoration inside one block can show
 * neither their types nor their positions.
 */
const COMMITTABLE_OPERATION = "insert_blocks";

/**
 * The part of a growing markdown payload whose block structure is already
 * decided, and the tail that is still arriving.
 *
 * A blank line is the boundary because it is the only one markdown cannot take
 * back: a single newline may be a lazy continuation of the same paragraph, and
 * a line inside a fence is not a block at all. The last complete chunk is held
 * back too — per operation, so every operation the closing call still owns has
 * something to apply and reconciliation never has to remove one outright.
 */
export function splitCommittableMarkdown(markdown: string): {
	committed: string;
	tail: string;
} {
	const boundaries: number[] = [];
	let isFenceOpen = false;
	let characterIndex = 0;
	for (const line of markdown.split("\n")) {
		const lineStart = characterIndex;
		characterIndex += line.length + 1;
		if (/^[ \t]*(```|~~~)/.test(line)) {
			isFenceOpen = !isFenceOpen;
			continue;
		}
		if (!isFenceOpen && line.trim().length === 0 && lineStart > 0) {
			boundaries.push(Math.min(characterIndex, markdown.length));
		}
	}

	for (let index = boundaries.length - 1; index >= 0; index -= 1) {
		const boundary = boundaries[index]!;
		if (markdown.slice(boundary).trim().length > 0) {
			return {
				committed: markdown.slice(0, boundary),
				tail: markdown.slice(boundary),
			};
		}
	}
	return { committed: "", tail: markdown };
}

export interface StreamingBlockCommitter {
	/**
	 * Writes whatever the fragment completed and returns the preview for what
	 * is left: anchored after the last written block, so the tail reads as the
	 * next block rather than as more of the previous one.
	 */
	absorb(
		update: EditDocumentPreviewUpdate | null,
	): EditDocumentPreviewUpdate | null;
	/** The closing call, with the already-written prefixes removed. */
	reconcile(input: unknown): unknown;
	/** The call landed: forget the prefixes, keep what they wrote. */
	settle(): void;
	rollback(): void;
	readonly committedBlockIds: readonly string[];
}

/** What has been written for one operation of the payload. */
interface CommittedOperation {
	/** The exact prefix of this operation's markdown that is in the document. */
	committedText: string;
	/** Where this operation's next chunk goes. */
	anchorBlockId: string;
	/** Set when a write was refused; the rest belongs to the closing call. */
	isStopped: boolean;
}

export function createStreamingBlockCommitter(options: {
	editor: Editor;
	origin: OpOrigin;
	undoGroupId?: string | null;
	/**
	 * Asks whether this many operations may be written. Streamed writes happen
	 * outside an open tool call, so nothing else charges them against the
	 * turn's budget, and an uncharged write is a way to write an unbounded
	 * document one fragment at a time.
	 */
	chargeOps?: (count: number) => boolean;
	rejectBlocks?: (blockIds: readonly string[]) => void;
}): StreamingBlockCommitter {
	const { editor, origin, chargeOps, rejectBlocks } = options;
	const applyOptions = {
		origin,
		...(options.undoGroupId ? { undoGroupId: options.undoGroupId } : {}),
	};
	let toolCallId: string | null = null;
	let committed = new Map<number, CommittedOperation>();
	let insertedBlockIds: string[] = [];

	const reset = (): void => {
		toolCallId = null;
		committed = new Map();
		insertedBlockIds = [];
	};

	/** The anchor for the next chunk, or null when nothing was written. */
	const writeChunk = (chunk: string, anchor: string): string | null => {
		const { ops } = buildDocumentWriteOps(editor, {
			format: "markdown",
			// The chunk ends at the blank line that proved it complete; keeping
			// that line would write an empty paragraph after every block.
			content: chunk.replace(/\s+$/, ""),
			position: { after: anchor },
			surface: "edit-document",
		});
		if (ops.length === 0 || (chargeOps && !chargeOps(ops.length))) {
			return null;
		}
		applyAIOpsForBoundMutationMode(
			editor,
			ops as DocumentOp[],
			applyOptions,
		);
		const written = ops
			.filter((op) => op.type === "insert-block")
			.map((op) => op.blockId);
		insertedBlockIds.push(...written);
		return written[written.length - 1] ?? anchor;
	};

	const rollback = (): void => {
		const written = insertedBlockIds;
		reset();
		if (written.length === 0) {
			return;
		}
		rejectBlocks?.(written);
		const surviving = written.filter(
			(blockId) => editor.getBlock(blockId) != null,
		);
		if (surviving.length === 0) {
			return;
		}
		editor.apply(
			surviving.map(
				(blockId) =>
					({ type: "delete-block", blockId }) satisfies DocumentOp,
			),
			applyOptions,
		);
	};

	return {
		absorb(update) {
			if (update == null) {
				return null;
			}
			if (update.toolCallId !== toolCallId) {
				reset();
				toolCallId = update.toolCallId;
			}
			if (
				update.operation !== COMMITTABLE_OPERATION ||
				update.markdown == null
			) {
				return update;
			}
			const state = committed.get(update.operationIndex);
			const anchor = state?.anchorBlockId ?? update.blockId;
			if (anchor == null || editor.getBlock(anchor) == null) {
				return update;
			}

			let next: CommittedOperation = state ?? {
				committedText: "",
				anchorBlockId: anchor,
				isStopped: false,
			};
			const { committed: committable } = splitCommittableMarkdown(
				update.markdown,
			);
			if (
				!next.isStopped &&
				committable.length > next.committedText.length &&
				committable.startsWith(next.committedText)
			) {
				const chunk = committable.slice(next.committedText.length);
				if (chunk.trim().length === 0) {
					next = { ...next, committedText: committable };
				} else {
					const anchorAfter = writeChunk(chunk, next.anchorBlockId);
					next =
						anchorAfter == null
							? { ...next, isStopped: true }
							: {
									committedText: committable,
									anchorBlockId: anchorAfter,
									isStopped: false,
								};
				}
			}
			committed.set(update.operationIndex, next);

			// Everything not in the document is still arriving as far as the
			// reader is concerned, including the chunk held back for the
			// closing call and anything a refused write left behind.
			const pending = update.markdown.slice(next.committedText.length);
			const remainder = {
				...update,
				text: toStreamingPreviewText(pending),
				markdown: pending,
			};
			// Once a block is written, what is still arriving follows the
			// last one written, wherever the operation was first placed.
			return next.anchorBlockId === update.blockId
				? remainder
				: {
						...remainder,
						blockId: next.anchorBlockId,
						blockIds: [next.anchorBlockId],
						placement: "after",
					};
		},

		reconcile(input) {
			if (committed.size === 0) {
				return input;
			}
			const operations = readOperations(input);
			const rewritten: unknown[] = [];
			for (const [index, operation] of operations.entries()) {
				const state = committed.get(index);
				if (state == null || state.committedText.length === 0) {
					rewritten.push(operation);
					continue;
				}
				const remainder = readUncommittedRemainder(
					operation,
					state.committedText,
				);
				// A payload that does not start with what was written is a
				// payload this committer did not see grow. Applying the
				// remainder of a different string would splice two edits
				// together, so give the document back and let the call apply
				// all of itself.
				if (remainder == null) {
					rollback();
					return input;
				}
				rewritten.push({
					...(operation as Record<string, unknown>),
					blockId: state.anchorBlockId,
					placement: "after",
					markdown: remainder,
				});
			}
			// Written for an operation the closing call does not have.
			if (
				[...committed.keys()].some(
					(index) => index >= operations.length,
				)
			) {
				rollback();
				return input;
			}
			return {
				...(input as Record<string, unknown>),
				operations: rewritten,
			};
		},

		settle() {
			reset();
		},

		rollback,

		get committedBlockIds() {
			return insertedBlockIds;
		},
	};
}

/**
 * The operations exactly as sent. Not filtered: an index is what ties a
 * committed prefix to the operation it came from, so dropping an entry here
 * would rewrite the wrong operation — and quietly remove the malformed one
 * from the call, hiding the schema refusal it is owed.
 */
function readOperations(input: unknown): unknown[] {
	const operations = (input as { operations?: unknown } | null)?.operations;
	return Array.isArray(operations) ? operations : [];
}

/** What is left of a committable operation, or null if it is not the one written. */
function readUncommittedRemainder(
	operation: unknown,
	committedText: string,
): string | null {
	if (
		operation == null ||
		typeof operation !== "object" ||
		Array.isArray(operation)
	) {
		return null;
	}
	const { operation: name, markdown } = operation as Record<string, unknown>;
	if (
		name !== COMMITTABLE_OPERATION ||
		typeof markdown !== "string" ||
		!markdown.startsWith(committedText)
	) {
		return null;
	}
	const remainder = markdown.slice(committedText.length);
	return remainder.trim().length === 0 ? null : remainder;
}
