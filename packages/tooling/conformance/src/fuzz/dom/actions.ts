import type { DocumentOp } from "@input/pen-types";
import type { FuzzBlockView } from "../../types";
import type { FuzzRng } from "./seed";

/**
 * Weighted action generators for the DOM fuzzer (W3.R19 §3.15). Step 9 of
 * W3 ships the minimal set; the remaining §3.15 actions arrive with step 22.
 * Every action records concrete arguments, so a trace replays without the
 * generator.
 */
export type FuzzPoint = { blockId: string; offset: number };

export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export type FuzzAction =
	| { kind: "click"; args: FuzzPoint }
	| { kind: "drag"; args: { from: FuzzPoint; to: FuzzPoint } }
	| { kind: "arrow"; args: { key: ArrowKey } }
	| { kind: "shift-arrow"; args: { key: ArrowKey } }
	| { kind: "type"; args: { graphemes: string[] } }
	| { kind: "enter"; args: FuzzPoint }
	| { kind: "backspace"; args: FuzzPoint }
	| { kind: "select-all"; args: { presses: number } }
	| { kind: "undo"; args: Record<string, never> }
	| { kind: "redo"; args: Record<string, never> }
	| { kind: "remote"; args: { ops: DocumentOp[] } }
	/** `PEN_FUZZ_FORCE_FAIL_AT`: the self-test's planted S2 violation. */
	| { kind: "force-fail"; args: Record<string, never> };

export type FuzzActionKind = FuzzAction["kind"];

export type FuzzStep = FuzzAction & { i: number };

type GeneratedKind = Exclude<FuzzActionKind, "force-fail">;

const ACTION_WEIGHTS: Readonly<Record<GeneratedKind, number>> = {
	click: 3,
	drag: 2,
	arrow: 3,
	"shift-arrow": 2,
	type: 3,
	enter: 1,
	backspace: 2,
	"select-all": 1,
	undo: 1,
	redo: 1,
	remote: 2,
};

const ARROWS: readonly ArrowKey[] = [
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"ArrowDown",
];

/** Plain, combining, astral and ZWJ graphemes; each one is typed as a unit. */
const GRAPHEMES = [
	"a",
	"k",
	"Z",
	" ",
	"é",
	"ñ",
	"\u{1F600}",
	"\u{1D4B3}",
	"\u{1F468}‍\u{1F469}‍\u{1F467}",
] as const;

const REMOTE_WORDS = ["peer", "remote", "x", "collab "] as const;

/** Drags stay within this many blocks so both ends share the viewport. */
const DRAG_SPAN = 3;

/** Remote deletes keep at least this many text blocks around. */
const MIN_TEXT_BLOCKS = 6;

export type GenerateContext = {
	seed: number;
	i: number;
	blocks: readonly FuzzBlockView[];
};

function pickKind(rng: FuzzRng): GeneratedKind {
	const entries = Object.entries(ACTION_WEIGHTS) as [GeneratedKind, number][];
	const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
	let roll = rng.next() * total;
	for (const [kind, weight] of entries) {
		roll -= weight;
		if (roll < 0) {
			return kind;
		}
	}
	return entries[entries.length - 1]![0];
}

function textBlocks(blocks: readonly FuzzBlockView[]): FuzzBlockView[] {
	return blocks.filter((block) => block.kind === "text");
}

function randomPoint(rng: FuzzRng, block: FuzzBlockView): FuzzPoint {
	return { blockId: block.id, offset: rng.int(block.length + 1) };
}

function edgePoint(rng: FuzzRng, blocks: readonly FuzzBlockView[]): FuzzPoint {
	const block = rng.pick(textBlocks(blocks));
	return { blockId: block.id, offset: rng.next() < 0.5 ? 0 : block.length };
}

function dragArgs(
	rng: FuzzRng,
	blocks: readonly FuzzBlockView[],
): { from: FuzzPoint; to: FuzzPoint } {
	const fromIndex = rng.int(blocks.length);
	const span = rng.int(DRAG_SPAN * 2 + 1) - DRAG_SPAN;
	const toIndex = Math.min(blocks.length - 1, Math.max(0, fromIndex + span));
	return {
		from: randomPoint(rng, blocks[fromIndex]!),
		to: randomPoint(rng, blocks[toIndex]!),
	};
}

function remoteSplice(
	rng: FuzzRng,
	blocks: readonly FuzzBlockView[],
): DocumentOp[] {
	const block = rng.pick(textBlocks(blocks));
	const from = rng.int(block.length + 1);
	const to = Math.min(block.length, from + rng.int(3));
	return [
		{
			type: "splice-text",
			blockId: block.id,
			from,
			to,
			insert: rng.pick(REMOTE_WORDS),
		},
	];
}

function remoteInsertBlock(
	rng: FuzzRng,
	context: GenerateContext,
): DocumentOp[] {
	const blockId = `fuzz-remote-${context.seed}-${context.i}`;
	return [
		{
			type: "insert-block",
			blockId,
			blockType: "paragraph",
			props: {},
			position: { after: rng.pick(context.blocks).id },
		},
		{
			type: "splice-text",
			blockId,
			from: 0,
			to: 0,
			insert: "Remote block",
		},
	];
}

function remoteOps(rng: FuzzRng, context: GenerateContext): DocumentOp[] {
	const paragraphs = context.blocks.filter(
		(block) => block.type === "paragraph",
	);
	const roll = rng.int(3);
	if (
		roll === 2 &&
		textBlocks(context.blocks).length > MIN_TEXT_BLOCKS &&
		paragraphs.length > 0
	) {
		return [{ type: "delete-block", blockId: rng.pick(paragraphs).id }];
	}
	return roll === 1
		? remoteInsertBlock(rng, context)
		: remoteSplice(rng, context.blocks);
}

function typedGraphemes(rng: FuzzRng): string[] {
	return Array.from({ length: 1 + rng.int(6) }, () => rng.pick(GRAPHEMES));
}

type ArgsOf<K extends FuzzActionKind> = Extract<
	FuzzAction,
	{ kind: K }
>["args"];

/** Argument generator per kind; the mapped type fails to compile when a kind is added without one. */
const ARGS_GENERATORS: {
	[K in GeneratedKind]: (rng: FuzzRng, context: GenerateContext) => ArgsOf<K>;
} = {
	click: (rng, { blocks }) => randomPoint(rng, rng.pick(blocks)),
	drag: (rng, { blocks }) => dragArgs(rng, blocks),
	arrow: (rng) => ({ key: rng.pick(ARROWS) }),
	"shift-arrow": (rng) => ({ key: rng.pick(ARROWS) }),
	type: (rng) => ({ graphemes: typedGraphemes(rng) }),
	enter: (rng, { blocks }) => edgePoint(rng, blocks),
	backspace: (rng, { blocks }) => edgePoint(rng, blocks),
	"select-all": (rng) => ({ presses: 1 + rng.int(4) }),
	undo: () => ({}),
	redo: () => ({}),
	remote: (rng, context) => ({ ops: remoteOps(rng, context) }),
};

function actionOfKind(
	kind: GeneratedKind,
	rng: FuzzRng,
	context: GenerateContext,
): FuzzAction {
	const generate = ARGS_GENERATORS[kind] as (
		rng: FuzzRng,
		context: GenerateContext,
	) => FuzzAction["args"];
	return { kind, args: generate(rng, context) } as FuzzAction;
}

/** The next action for the document as the last check saw it. */
export function generateAction(
	rng: FuzzRng,
	context: GenerateContext,
): FuzzAction {
	if (textBlocks(context.blocks).length === 0) {
		throw new Error("fuzz: the document has no text block left to act on");
	}
	return actionOfKind(pickKind(rng), rng, context);
}
