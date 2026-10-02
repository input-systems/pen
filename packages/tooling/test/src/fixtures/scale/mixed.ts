import type { DocumentOp } from "@input/pen-types";
import type { TestBlock } from "../../types";

/**
 * Large mixed-block fixtures for renderer measurement (SCALE1: raising a
 * number means raising a fixture). Every value is a pure function of the
 * root position, so two runs build the same document.
 */

/** Root-block counts the conformance catalog ships. Each is a multiple of 20. */
export const MIXED_FIXTURE_SIZES = [1_000, 5_000, 10_000, 50_000] as const;

const PERIOD = 20;
const TABLE_EVERY = 1_000;
const TABLE_OFFSET = 500;
const BOLD_EVERY = 40;

const LEXICON = [
	"The quick brown fox jumps over the lazy dog again today.",
	"Every paragraph here carries ten plain words of steady prose.",
	"Renderer counts stay durable where wall clocks drift with load.",
	"A caret move should touch two blocks and nothing more.",
	"Large documents test whether work scales with the change alone.",
	"Selection, decorations, and lists all fan out per block here.",
	"Typing in the middle of the document must stay cheap always.",
	"This sentence exists so measured text has realistic word shapes.",
] as const;

/** Stable id for the block at root position `index`. */
export function mixedBlockId(index: number): string {
	return `scale-block-${index}`;
}

function isTableSlot(index: number): boolean {
	return index % TABLE_EVERY === TABLE_OFFSET;
}

function paragraphText(index: number): string {
	return `Block ${index} ${LEXICON[index % LEXICON.length]}`;
}

function assertRootCount(rootCount: number): void {
	if (!Number.isInteger(rootCount) || rootCount < PERIOD || rootCount % PERIOD !== 0) {
		throw new Error(
			`mixed fixture rootCount must be a positive multiple of ${PERIOD}, got ${rootCount}`,
		);
	}
}

type SlotFactory = (id: string, index: number) => TestBlock[];

const textBlock =
	(type: string, props?: (index: number) => Record<string, unknown>): SlotFactory =>
	(id, index) => [{ id, type, props: props?.(index), content: paragraphText(index) }];

const PARAGRAPH = textBlock("paragraph");

/** Block factory per `i % 20`; slots not listed are paragraphs. */
const SLOTS: Readonly<Record<number, SlotFactory>> = {
	0: (id, index) => [
		{
			id,
			type: "heading",
			props: { level: (Math.floor(index / PERIOD) % 3) + 1 },
			content: `Section ${index}`,
		},
	],
	7: textBlock("bulletListItem", () => ({ indent: 0 })),
	8: textBlock("bulletListItem", () => ({ indent: 1 })),
	9: textBlock("bulletListItem", () => ({ indent: 0 })),
	10: textBlock("numberedListItem", () => ({ indent: 0 })),
	11: textBlock("numberedListItem", () => ({ indent: 0 })),
	12: textBlock("numberedListItem", () => ({ indent: 1 })),
	13: textBlock("checkListItem", (index) => ({ checked: index % 40 === 13 })),
	14: textBlock("blockquote"),
	15: (id, index) => [
		{ id, type: "codeBlock", content: `const block${index} = ${index};\nreturn block${index};` },
	],
	17: (id, index) => [
		{ id, type: "toggle", props: { open: true }, content: `Toggle ${index}` },
		{ id: `${id}-child`, type: "paragraph", props: { parentId: id }, content: paragraphText(index) },
	],
	18: (id) => [{ id, type: "divider" }],
};

/** The block (and toggle child, if any) at root position `index`. */
function blocksAt(index: number): TestBlock[] {
	const factory = SLOTS[index % PERIOD] ?? PARAGRAPH;
	return factory(mixedBlockId(index), index);
}

/**
 * Skeleton for `populateYDoc`: every root block except the table slots, plus
 * one `parentId` child per toggle, placed directly after its toggle.
 */
export function generateMixedBlockSpecs(rootCount: number): TestBlock[] {
	assertRootCount(rootCount);
	const blocks: TestBlock[] = [];
	for (let index = 0; index < rootCount; index += 1) {
		if (!isTableSlot(index)) {
			blocks.push(...blocksAt(index));
		}
	}
	return blocks;
}

/**
 * Ops that finish the fixture through `editor.apply` (`populateYDoc` drops
 * marks and tables): a default-grid table at each table slot with every cell
 * spliced, and `bold` on [0, 5) of every 40th paragraph slot. Apply with
 * `{ origin: "system" }` before any surface mounts.
 */
export function mixedFixtureOps(rootCount: number): DocumentOp[] {
	assertRootCount(rootCount);
	const ops: DocumentOp[] = [];
	for (let index = TABLE_OFFSET; index < rootCount; index += TABLE_EVERY) {
		const blockId = mixedBlockId(index);
		ops.push({
			type: "insert-block",
			blockId,
			blockType: "table",
			props: {},
			position: { after: mixedBlockId(index - 1) },
		});
		for (const [row, col] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
			ops.push({
				type: "splice-text",
				blockId,
				cell: { row, col },
				from: 0,
				to: 0,
				insert: `r${row}c${col} of ${index}`,
			});
		}
	}
	for (let index = 1; index < rootCount; index += BOLD_EVERY) {
		ops.push({
			type: "format-text",
			blockId: mixedBlockId(index),
			from: 0,
			to: 5,
			marks: { bold: true },
		});
	}
	return ops;
}

export interface MixedFixtureIdentity {
	/** Root blocks after `mixedFixtureOps` runs. */
	readonly rootCount: number;
	/** Root blocks plus `parentId` toggle children, which sit in `blockOrder`. */
	readonly blockOrderLength: number;
	/** Every block, which equals the mounted `[data-pen-editor-block]` count. */
	readonly totalBlocks: number;
	readonly tableCount: number;
	/** Block type to root count. */
	readonly composition: Readonly<Record<string, number>>;
}

/** The counts the fixture must have after `mixedFixtureOps` runs. */
export function mixedFixtureIdentity(rootCount: number): MixedFixtureIdentity {
	assertRootCount(rootCount);
	const composition: Record<string, number> = {};
	let toggles = 0;
	for (let index = 0; index < rootCount; index += 1) {
		const type = isTableSlot(index) ? "table" : blocksAt(index)[0]!.type;
		composition[type] = (composition[type] ?? 0) + 1;
		if (type === "toggle") toggles += 1;
	}
	return {
		rootCount,
		blockOrderLength: rootCount + toggles,
		totalBlocks: rootCount + toggles,
		tableCount: composition.table ?? 0,
		composition,
	};
}

export interface MixedFixtureTargets {
	/** First paragraph at or after the middle with `i % 20 === 1`. */
	readonly paragraph: string;
	/** The paragraph after it (`i % 20 === 2`). */
	readonly nextParagraph: string;
	/** Second item of a three-item numbered run (`i % 20 === 11`). */
	readonly numbered: string;
	/** Remote-insert anchor (`paragraph + 5`). */
	readonly insertAfter: string;
}

/** Block ids the scripted actions target, the same slots at every size. */
export function mixedFixtureTargets(rootCount: number): MixedFixtureTargets {
	assertRootCount(rootCount);
	const middle = rootCount / 2;
	const paragraph = middle + ((1 - (middle % PERIOD) + PERIOD) % PERIOD);
	return {
		paragraph: mixedBlockId(paragraph),
		nextParagraph: mixedBlockId(paragraph + 1),
		numbered: mixedBlockId(paragraph + 10),
		insertAfter: mixedBlockId(paragraph + 5),
	};
}
