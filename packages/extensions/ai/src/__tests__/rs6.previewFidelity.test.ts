import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inlineLogicalText } from "@input/pen-core";
import type { Decoration, Editor, InlineDecoration } from "@input/pen-types";
import { getAIController } from "../index";
import {
	AI_REVIEW_ROLE_ATTRIBUTE,
	FINAL_TEXT_REVIEW_HIDDEN_ATTRIBUTE,
} from "../review/reviewPresentationState";
import {
	composePreview,
	projectAccepted,
	type ComposedPreview,
} from "./fixtures/composePreview";
import {
	EDIT_CHANNEL_CORPUS,
	seedEditChannelCorpus,
	type EditChannelCorpusPromptId,
	type EditChannelCorpusSeed,
} from "./fixtures/editChannelCorpus";
import allowlist from "./fixtures/rs6-fidelity-allowlist.json";
import {
	RS6_POSTURES,
	applyCorpusPrefix,
	corpusOperationCount,
	createRs6Editor,
	idleModel,
	runRs6Turn,
	type Rs6Posture,
	type Rs6Frame,
	type Rs6Turn,
} from "./fixtures/rs6Driver";

/**
 * RS6: preview fidelity as a property over the edit-channel reference corpus.
 *
 * After each operation of a streamed `edit_document` call arrives, the
 * preview's hidden ranges and virtual inserts are composed into the visible
 * document and compared with a fresh copy that applied the same operations.
 * A hidden range the composition did not consume fails the case, so it cannot
 * pass over nothing.
 *
 * Known gaps are listed in `rs6-fidelity-allowlist.json`; a listed case must
 * still fail, so a fix that closes one has to remove its entry (I15).
 */

interface AllowlistEntry {
	corpusId: EditChannelCorpusPromptId;
	posture: Rs6Posture;
	operationIndex: number;
	reason: string;
	closedBy: string;
}

interface Rs6Case {
	id: EditChannelCorpusPromptId;
	posture: Rs6Posture;
	operationIndex: number;
}

const ENTRIES = allowlist.entries as readonly AllowlistEntry[];

/** Operations that name exactly one block whose text the property compares. */
const SINGLE_BLOCK_OPERATIONS = new Set([
	"replace_block_text",
	"format_text",
	"set_block_props",
]);

const CORPUS_IDS = EDIT_CHANNEL_CORPUS.map((entry) => entry.id);

function isListed({ id, posture, operationIndex }: Rs6Case): boolean {
	return ENTRIES.some(
		(entry) =>
			entry.corpusId === id &&
			entry.posture === posture &&
			entry.operationIndex === operationIndex,
	);
}

/** The preview editor's id for a block, as the fresh copy names it. */
function mapSeedId(
	id: string,
	from: EditChannelCorpusSeed,
	to: EditChannelCorpusSeed,
): string {
	return id === from.headingId ? to.headingId : id;
}

/**
 * Whether getting from `before` to `after` takes any text away: when every
 * character of `before` survives in order, inserts alone can show the edit.
 */
function needsRemoval(before: string, after: string): boolean {
	let cursor = 0;
	for (const character of after) {
		if (cursor < before.length && before[cursor] === character) {
			cursor += 1;
		}
	}
	return cursor < before.length;
}

function readOperationName(operation: unknown): string {
	return String((operation as { operation?: unknown }).operation);
}

function readOperationBlockId(operation: unknown): string | null {
	const blockId = (operation as { blockId?: unknown }).blockId;
	return typeof blockId === "string" ? blockId : null;
}

function describeLines(lines: readonly string[]): string {
	return JSON.stringify(lines);
}

async function evaluateFrame(
	turn: Rs6Turn,
	{ id, operationIndex }: Rs6Case,
): Promise<string | null> {
	const frame = turn.frames.find(
		(candidate) => candidate.operationIndex === operationIndex,
	);
	if (!frame) {
		return `no frame recorded for operation ${operationIndex}`;
	}
	const { composed } = frame;
	if (
		composed.deleteDecorationsConsumed !== composed.deleteDecorationsEmitted
	) {
		return `the composition consumed ${composed.deleteDecorationsConsumed} of ${composed.deleteDecorationsEmitted} hidden ranges`;
	}
	// A move previews no text (RS6), so once one is among the operations the
	// lines are compared as a set: the text must match, the order cannot yet.
	const reorders = turn.operations
		.slice(0, operationIndex + 1)
		.some((operation) => readOperationName(operation) === "move_block");
	const fresh = await applyCorpusPrefix(id, operationIndex + 1);
	try {
		return (
			compareDocument(frame, projectAccepted(fresh.editor), reorders) ??
			compareTargetBlock(turn, fresh, operationIndex, frame.composed)
		);
	} finally {
		fresh.editor.destroy();
	}
}

function compareDocument(
	frame: Rs6Frame,
	accepted: readonly string[],
	reorders: boolean,
): string | null {
	const { composed } = frame;
	if (
		!reorders &&
		needsRemoval(frame.documentLines.join("\n"), accepted.join("\n")) &&
		composed.deleteDecorationsEmitted === 0
	) {
		return "accepting removes text but the preview emitted no hidden range";
	}
	const shownLines = reorders ? [...composed.lines].sort() : composed.lines;
	const acceptedLines = reorders ? [...accepted].sort() : accepted;
	return shownLines.join("\n") === acceptedLines.join("\n")
		? null
		: `preview ${describeLines(shownLines)} != accepted ${describeLines(acceptedLines)}`;
}

/** Single-block operations also compare the block they name on its own. */
function compareTargetBlock(
	turn: Rs6Turn,
	fresh: { editor: Editor; seed: EditChannelCorpusSeed },
	operationIndex: number,
	composed: ComposedPreview,
): string | null {
	const operation = turn.operations[operationIndex];
	const blockId = readOperationBlockId(operation);
	if (
		!SINGLE_BLOCK_OPERATIONS.has(readOperationName(operation)) ||
		blockId == null
	) {
		return null;
	}
	const freshBlock = fresh.editor.getBlock(
		mapSeedId(blockId, turn.seed, fresh.seed),
	);
	const expected = freshBlock ? inlineLogicalText(freshBlock) : "";
	const shown = composed.byBlock.get(blockId) ?? "";
	// An earlier insert placed beside this block previews inside it as lines
	// of its own; the block's text is then the line that is not inserted.
	const hasInsertBeside = turn.operations
		.slice(0, operationIndex)
		.some(
			(earlier) =>
				readOperationName(earlier) === "insert_blocks" &&
				readOperationBlockId(earlier) === blockId,
		);
	const matches = hasInsertBeside
		? shown.split("\n").includes(expected)
		: shown === expected;
	return matches
		? null
		: `block ${blockId} previews ${JSON.stringify(shown)}, accept gives ${JSON.stringify(expected)}`;
}

async function evaluateEndOfTurn(
	turn: Rs6Turn,
	{ id, posture }: Rs6Case,
): Promise<string | null> {
	if (turn.generation.status !== "complete") {
		return `generation finished ${turn.generation.status}`;
	}
	if (posture === "suggestions") {
		getAIController(turn.editor)!.acceptAllSuggestions();
	}
	const fresh = await applyCorpusPrefix(id, turn.operations.length);
	try {
		const landed = projectAccepted(turn.editor);
		const accepted = projectAccepted(fresh.editor);
		return landed.join("\n") === accepted.join("\n")
			? null
			: `landed ${describeLines(landed)} != fresh ${describeLines(accepted)}`;
	} finally {
		fresh.editor.destroy();
	}
}

const operationCounts = new Map<EditChannelCorpusPromptId, number>();
for (const id of CORPUS_IDS) {
	operationCounts.set(id, await corpusOperationCount(id));
}

const RS6_CASES: readonly Rs6Case[] = CORPUS_IDS.flatMap((id) =>
	RS6_POSTURES.flatMap((posture) =>
		Array.from(
			{ length: operationCounts.get(id)! },
			(_, operationIndex) => ({
				id,
				posture,
				operationIndex,
			}),
		),
	),
);

describe("RS6: the streamed edit_document preview shows what accept applies", () => {
	const turns = new Map<string, Rs6Turn>();

	beforeAll(async () => {
		for (const id of CORPUS_IDS) {
			for (const posture of RS6_POSTURES) {
				turns.set(`${id}:${posture}`, await runRs6Turn(id, posture));
			}
		}
	});

	afterAll(() => {
		for (const turn of turns.values()) {
			turn.editor.destroy();
		}
	});

	for (const rs6Case of RS6_CASES) {
		const { id, posture, operationIndex } = rs6Case;
		it(`RS6: ${id} ${posture} operation ${operationIndex} — the preview shows what accept applies`, async () => {
			const turn = turns.get(`${id}:${posture}`)!;
			let failure = await evaluateFrame(turn, rs6Case);
			if (
				failure == null &&
				operationIndex === turn.operations.length - 1
			) {
				failure = await evaluateEndOfTurn(turn, rs6Case);
			}
			if (isListed(rs6Case)) {
				expect(
					failure,
					`${id} ${posture} operation ${operationIndex} now passes: remove the entry from rs6-fidelity-allowlist.json`,
				).not.toBeNull();
				return;
			}
			expect(failure, failure ?? undefined).toBeNull();
		});
	}

	it("RS6: every allowlist entry names a corpus case closed by W7.R2", () => {
		for (const entry of ENTRIES) {
			expect(
				RS6_CASES.some(
					(candidate) =>
						candidate.id === entry.corpusId &&
						candidate.posture === entry.posture &&
						candidate.operationIndex === entry.operationIndex,
				),
				`orphaned allowlist entry ${JSON.stringify(entry)}`,
			).toBe(true);
			expect(entry.closedBy).toBe("W7.R2");
		}
	});
});

function hiddenRange(
	blockId: string,
	from: number,
	to: number,
): InlineDecoration {
	return {
		type: "inline",
		blockId,
		from,
		to,
		attributes: {
			[AI_REVIEW_ROLE_ATTRIBUTE]: "delete-hidden",
			[FINAL_TEXT_REVIEW_HIDDEN_ATTRIBUTE]: true,
		},
		omitFromRender: true,
	};
}

describe("RS6: the composition guard", () => {
	let editor: Editor;
	let seed: EditChannelCorpusSeed;

	beforeAll(async () => {
		editor = createRs6Editor(idleModel(), "direct");
		await editor.whenReady();
		seed = seedEditChannelCorpus(editor);
	});

	afterAll(() => {
		editor.destroy();
	});

	it("RS6: the composition consumed every hidden range it was given", () => {
		const decorations: Decoration[] = [
			hiddenRange(seed.introId, 0, 5),
			hiddenRange(seed.closingId, 0, 8),
		];
		const composed = composePreview(editor, decorations);
		expect(composed.deleteDecorationsEmitted).toBe(2);
		expect(composed.deleteDecorationsConsumed).toBe(2);
		expect(composed.byBlock.get(seed.introId)).toBe(
			seed.introText.slice(5),
		);
		expect(composed.byBlock.get(seed.closingId)).toBe(
			seed.closingText.slice(8),
		);

		// A composer that drops a hidden range still produces a plausible
		// document; only the count gives it away.
		const second = decorations[1];
		const broken = composePreview(editor, decorations, {
			consume: (decoration) => decoration !== second,
		});
		expect(broken.deleteDecorationsEmitted).toBe(2);
		expect(broken.deleteDecorationsConsumed).toBe(1);
	});
});
