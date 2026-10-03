import type { DocumentOp } from "@input/pen-types";
import type { FuzzBlockView } from "../../types";
import type { FuzzRng } from "./seed";

/**
 * Weighted action generators for the DOM fuzzer (W3.R19 §3.15). Every
 * action records concrete arguments, so a trace replays without the
 * generator. Two weight tables: the PR set (`PR_ACTION_WEIGHTS`, the step-9
 * kinds, frozen so the fixed PR seeds keep their traces) and the full §3.15
 * set the nightly soak runs; a kind joins the PR set only after ten green
 * nightly-length runs.
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
	| { kind: "double-click"; args: FuzzPoint }
	| { kind: "triple-click"; args: FuzzPoint }
	| { kind: "home-end"; args: { key: "Home" | "End"; shift: boolean } }
	| { kind: "delete"; args: FuzzPoint }
	/** Click beside the n-th inline atom (wrapping), then arrow across it. */
	| { kind: "atom-step"; args: { atomIndex: number; side: "left" | "right"; key: "ArrowLeft" | "ArrowRight" } }
	| { kind: "paste"; args: { html: string } }
	/** Chromium CDP composition with a remote apply between start and commit; elsewhere a plain remote apply. */
	| { kind: "remote-mid-composition"; args: { composing: string; commit: string; ops: DocumentOp[] } }
	| { kind: "context-menu"; args: FuzzPoint }
	| { kind: "escape"; args: Record<string, never> }
	/** W4 fills `blockWindow`; until then the executor records it skipped. */
	| { kind: "scroll"; args: { blockId: string } }
	/** A drag that scrolls while the button is held, across more than 50 blocks. */
	| { kind: "long-drag"; args: { from: FuzzPoint; to: FuzzPoint } }
	/** `PEN_FUZZ_FORCE_FAIL_AT`: the self-test's planted S2 violation. */
	| { kind: "force-fail"; args: Record<string, never> };

export type FuzzActionKind = FuzzAction["kind"];

export type FuzzStep = FuzzAction & { i: number };

type GeneratedKind = Exclude<FuzzActionKind, "force-fail">;

type PrKind =
	| "click"
	| "drag"
	| "arrow"
	| "shift-arrow"
	| "type"
	| "enter"
	| "backspace"
	| "select-all"
	| "undo"
	| "redo"
	| "remote";

/** The PR set. Its key order and weights are frozen: they decide the PR seeds' traces. */
const PR_ACTION_WEIGHTS: Readonly<Record<PrKind, number>> = {
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

/** The full §3.15 set; `long-drag` is drawn only on a document longer than 50 blocks. */
const FULL_ACTION_WEIGHTS: Readonly<Record<GeneratedKind, number>> = {
	...PR_ACTION_WEIGHTS,
	"double-click": 1,
	"triple-click": 1,
	"home-end": 1,
	delete: 1,
	"atom-step": 1,
	paste: 1,
	"remote-mid-composition": 1,
	"context-menu": 1,
	escape: 1,
	scroll: 1,
	"long-drag": 1,
};

export type FuzzActionSet = "pr" | "full";

const LONG_DRAG_MIN_SPAN = 51;

/** Small HTML paste payloads: marks, a list, a link, and two paragraphs. */
const PASTE_HTML = [
	"<p>pasted <strong>bold</strong> text</p>",
	"<ul><li>one</li><li>two</li></ul>",
	'<p>a <a href="https://example.com">link</a></p>',
	"<p>first</p><p>second</p>",
] as const;

const COMPOSITIONS = [
	{ composing: "か", commit: "漢" },
	{ composing: "ni", commit: "你" },
	{ composing: "e", commit: "é" },
] as const;

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
	/** Default `"pr"`. */
	actionSet?: FuzzActionSet;
};

function pickKind(rng: FuzzRng, context: GenerateContext): GeneratedKind {
	const weights: Readonly<Partial<Record<GeneratedKind, number>>> =
		context.actionSet === "full" ? FULL_ACTION_WEIGHTS : PR_ACTION_WEIGHTS;
	const entries = (Object.entries(weights) as [GeneratedKind, number][]).filter(
		([kind]) => kind !== "long-drag" || context.blocks.length >= LONG_DRAG_MIN_SPAN,
	);
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

function longDragArgs(
	rng: FuzzRng,
	blocks: readonly FuzzBlockView[],
): { from: FuzzPoint; to: FuzzPoint } {
	const text = textBlocks(blocks);
	const fromIndex = rng.int(Math.max(1, text.length - LONG_DRAG_MIN_SPAN));
	const toIndex = Math.min(
		text.length - 1,
		fromIndex + LONG_DRAG_MIN_SPAN + rng.int(Math.max(1, text.length - fromIndex - LONG_DRAG_MIN_SPAN)),
	);
	const [from, to] = rng.next() < 0.5 ? [fromIndex, toIndex] : [toIndex, fromIndex];
	return {
		from: randomPoint(rng, text[from]!),
		to: randomPoint(rng, text[to]!),
	};
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
	"double-click": (rng, { blocks }) => randomPoint(rng, rng.pick(textBlocks(blocks))),
	"triple-click": (rng, { blocks }) => randomPoint(rng, rng.pick(textBlocks(blocks))),
	"home-end": (rng) => ({ key: rng.next() < 0.5 ? "Home" : "End", shift: rng.next() < 0.5 }),
	delete: (rng, { blocks }) => edgePoint(rng, blocks),
	"atom-step": (rng) => ({
		atomIndex: rng.int(8),
		side: rng.next() < 0.5 ? "left" : "right",
		key: rng.next() < 0.5 ? "ArrowLeft" : "ArrowRight",
	}),
	paste: (rng) => ({ html: rng.pick(PASTE_HTML) }),
	"remote-mid-composition": (rng, context) => ({
		...rng.pick(COMPOSITIONS),
		ops: remoteSplice(rng, context.blocks),
	}),
	"context-menu": (rng, { blocks }) => randomPoint(rng, rng.pick(textBlocks(blocks))),
	escape: () => ({}),
	scroll: (rng, { blocks }) => ({ blockId: rng.pick(blocks).id }),
	"long-drag": (rng, { blocks }) => longDragArgs(rng, blocks),
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
	return actionOfKind(pickKind(rng, context), rng, context);
}
