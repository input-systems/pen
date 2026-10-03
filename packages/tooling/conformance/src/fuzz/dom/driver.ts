import type { DocumentOp } from "@input/pen-types";
import type { Page } from "@playwright/test";
import { getInlineOffsetPoint } from "../../domGeometry";
import type { FuzzCheckReport, ScenarioApi } from "../../types";
import {
	generateAction,
	type FuzzAction,
	type FuzzActionKind,
	type FuzzPoint,
	type FuzzStep,
} from "./actions";
import { evaluateFuzzReport, type FuzzVerdict } from "./invariants";
import { createFuzzRng } from "./seed";
import type { FuzzDomSnapshot, FuzzTrace } from "./trace";

/**
 * Playwright executor for the DOM fuzzer (W3.R19 §3.15): run one action,
 * wait for `whenIdle`, then ask the page for `fuzzCheck` and judge it.
 */
export type FuzzRunOptions = {
	seed: number;
	engine: string;
	fixture: string;
	steps: number;
	forceFailAt: number | null;
	/** Default `"pr"`. */
	actionSet?: "pr" | "full";
	/** Replay: execute these instead of generating. */
	replay?: readonly FuzzStep[];
};

async function scrollBlockIntoView(page: Page, blockId: string): Promise<void> {
	await page.evaluate((id) => {
		document
			.querySelector(`[data-block-id="${id}"]`)
			?.scrollIntoView({ block: "center" });
	}, blockId);
}

/** A text offset's client point, or the block's centre when it has no inline content. */
async function pointFor(
	page: Page,
	point: FuzzPoint,
): Promise<{ x: number; y: number }> {
	const hasInline = await page.evaluate(
		(id) =>
			document.querySelector(
				`[data-block-id="${id}"] [data-pen-inline-content]`,
			) !== null,
		point.blockId,
	);
	if (hasInline) {
		return getInlineOffsetPoint(page, point);
	}
	return page.evaluate((id) => {
		const block = document.querySelector(`[data-block-id="${id}"]`);
		if (!block) {
			throw new Error(`fuzz: no block element for ${id}`);
		}
		const rect = block.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	}, point.blockId);
}

async function clickAt(page: Page, point: FuzzPoint): Promise<void> {
	await scrollBlockIntoView(page, point.blockId);
	const { x, y } = await pointFor(page, point);
	await page.mouse.click(x, y);
}

/** Scrolls so both blocks are on screen when they fit, else centres `from`. */
async function scrollPairIntoView(page: Page, from: string, to: string): Promise<void> {
	await page.evaluate(
		({ fromId, toId }) => {
			const first = document.querySelector(`[data-block-id="${fromId}"]`);
			const second = document.querySelector(`[data-block-id="${toId}"]`);
			if (!first || !second) return;
			const a = first.getBoundingClientRect();
			const b = second.getBoundingClientRect();
			const top = Math.min(a.top, b.top);
			const bottom = Math.max(a.bottom, b.bottom);
			if (bottom - top <= window.innerHeight) {
				window.scrollBy(0, (top + bottom) / 2 - window.innerHeight / 2);
			} else {
				first.scrollIntoView({ block: "center" });
			}
		},
		{ fromId: from, toId: to },
	);
}

async function dragBetween(
	page: Page,
	from: FuzzPoint,
	to: FuzzPoint,
): Promise<void> {
	// Both ends on screen: a drag that relies on autoscroll ends wherever
	// the scroll timing leaves it, which varies with machine load.
	await scrollPairIntoView(page, from.blockId, to.blockId);
	const start = await pointFor(page, from);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	// The press can activate a field and reflow the page; measure the end
	// once that settles, so the drag lands where its args say under any load.
	await page.evaluate(() => window.__penConformance.whenIdle());
	const end = await pointFor(page, to);
	await page.mouse.move(end.x, end.y, { steps: 4 });
	await page.mouse.up();
}

/** Enter/Backspace: the caret is placed through the harness (programmatic), then a real key. */
async function keyAtPoint(
	page: Page,
	point: FuzzPoint,
	key: string,
): Promise<void> {
	await page.evaluate(({ blockId, offset }) => {
		window.__penConformance.selectTextById(blockId, offset);
	}, point);
	await page.evaluate(() => window.__penConformance.whenIdle());
	await page.keyboard.press(key);
}

async function typeGraphemes(
	page: Page,
	graphemes: readonly string[],
): Promise<void> {
	for (const grapheme of graphemes) {
		// keyboard.type splits by code point; a cluster arrives as one insertText.
		if (/^[\x20-\x7e]$/.test(grapheme)) {
			await page.keyboard.type(grapheme);
		} else {
			await page.keyboard.insertText(grapheme);
		}
	}
}

async function pressTimes(
	page: Page,
	key: string,
	times: number,
): Promise<void> {
	for (let press = 0; press < times; press += 1) {
		await page.keyboard.press(key);
	}
}

async function multiClickAt(page: Page, point: FuzzPoint, clickCount: number): Promise<void> {
	await scrollBlockIntoView(page, point.blockId);
	const { x, y } = await pointFor(page, point);
	await page.mouse.click(x, y, { clickCount });
}

/** Click just beside the n-th inline atom (wrapping), then arrow across it. */
async function atomStep(
	page: Page,
	args: { atomIndex: number; side: "left" | "right"; key: "ArrowLeft" | "ArrowRight" },
): Promise<void> {
	const point = await page.evaluate(({ atomIndex, side }) => {
		const atoms = [...document.querySelectorAll("[data-pen-editor-root] [data-pen-inline-atom]")];
		if (atoms.length === 0) return null;
		const atom = atoms[atomIndex % atoms.length]!;
		atom.scrollIntoView({ block: "center" });
		const rect = atom.getBoundingClientRect();
		return {
			x: side === "left" ? rect.left - 1 : rect.right + 1,
			y: rect.top + rect.height / 2,
		};
	}, args);
	if (!point) return;
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press(args.key);
}

/** Chromium: a real CDP composition with a remote apply between start and commit. */
async function remoteMidComposition(
	page: Page,
	args: { composing: string; commit: string; ops: readonly DocumentOp[] },
): Promise<void> {
	const remote = () =>
		page.evaluate((ops) => window.__penConformance.remoteApply(ops), args.ops);
	if (page.context().browser()?.browserType().name() !== "chromium") {
		await remote();
		return;
	}
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send("Input.imeSetComposition", {
			text: args.composing,
			selectionStart: args.composing.length,
			selectionEnd: args.composing.length,
		});
		await remote();
		await cdp.send("Input.insertText", { text: args.commit });
	} finally {
		await cdp.detach();
	}
}

async function contextMenuAt(page: Page, point: FuzzPoint): Promise<void> {
	await scrollBlockIntoView(page, point.blockId);
	const { x, y } = await pointFor(page, point);
	await page.mouse.click(x, y, { button: "right" });
	await page.keyboard.press("Escape");
}

/** W4's `blockWindow.reveal` when present; until then the step is a recorded no-op. */
async function scrollTo(page: Page, blockId: string): Promise<void> {
	await page.evaluate((id) => {
		const bridge = window.__penConformance as { blockWindow?: { reveal(id: string): void } };
		bridge.blockWindow?.reveal(id);
	}, blockId);
}

/** A drag whose far end is off screen: the page scrolls while the button is held. */
async function longDrag(page: Page, from: FuzzPoint, to: FuzzPoint): Promise<void> {
	await scrollBlockIntoView(page, from.blockId);
	const start = await pointFor(page, from);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await scrollBlockIntoView(page, to.blockId);
	const end = await pointFor(page, to);
	await page.mouse.move(end.x, end.y, { steps: 6 });
	await page.mouse.up();
}

type ArgsOf<K extends FuzzActionKind> = Extract<
	FuzzAction,
	{ kind: K }
>["args"];

/** One executor per action kind; the mapped type fails to compile when a kind is added without one. */
const EXECUTORS: {
	[K in FuzzActionKind]: (page: Page, args: ArgsOf<K>) => Promise<void>;
} = {
	click: (page, args) => clickAt(page, args),
	drag: (page, args) => dragBetween(page, args.from, args.to),
	arrow: (page, args) => page.keyboard.press(args.key),
	"shift-arrow": (page, args) => page.keyboard.press(`Shift+${args.key}`),
	type: (page, args) => typeGraphemes(page, args.graphemes),
	enter: (page, args) => keyAtPoint(page, args, "Enter"),
	backspace: (page, args) => keyAtPoint(page, args, "Backspace"),
	"select-all": (page, args) =>
		pressTimes(page, "ControlOrMeta+a", args.presses),
	undo: (page) => page.keyboard.press("ControlOrMeta+z"),
	redo: (page) => page.keyboard.press("ControlOrMeta+Shift+z"),
	remote: (page, args) =>
		page.evaluate(
			(ops) => window.__penConformance.remoteApply(ops),
			args.ops,
		),
	"double-click": (page, args) => multiClickAt(page, args, 2),
	"triple-click": (page, args) => multiClickAt(page, args, 3),
	"home-end": (page, args) =>
		page.keyboard.press(args.shift ? `Shift+${args.key}` : args.key),
	delete: (page, args) => keyAtPoint(page, args, "Delete"),
	"atom-step": (page, args) => atomStep(page, args),
	paste: (page, args) =>
		page.evaluate((html) => window.__penConformance.pasteHtml(html), args.html),
	"remote-mid-composition": (page, args) => remoteMidComposition(page, args),
	"context-menu": (page, args) => contextMenuAt(page, args),
	escape: (page) => page.keyboard.press("Escape"),
	scroll: (page, args) => scrollTo(page, args.blockId),
	"long-drag": (page, args) => longDrag(page, args.from, args.to),
	"force-fail": (page) =>
		page.evaluate(() => window.__penConformance.installBrokenProjector()),
};

function executeAction(page: Page, action: FuzzAction): Promise<void> {
	const execute = EXECUTORS[action.kind] as (
		page: Page,
		args: FuzzAction["args"],
	) => Promise<void>;
	return execute(page, action.args);
}

async function settleAndCheck(page: Page): Promise<FuzzCheckReport> {
	await page.evaluate(() => window.__penConformance.whenIdle());
	return page.evaluate(() => window.__penConformance.fuzzCheck());
}

async function domSnapshot(
	page: Page,
	report: FuzzCheckReport | null,
): Promise<FuzzDomSnapshot> {
	const observed = await page.evaluate(() => {
		const active = document.activeElement;
		const describe = (node: Node | null | undefined): string => {
			if (!node) return "null";
			const element = node instanceof Element ? node : node.parentElement;
			const block =
				element
					?.closest("[data-block-id]")
					?.getAttribute("data-block-id") ?? "-";
			return `${node.nodeName}@block:${block}`;
		};
		const selection = document.getSelection();
		return {
			activeElement: active
				? `${describe(active)} role=${active.getAttribute("role") ?? "-"}`
				: "null",
			nativeSelection: selection
				? `${describe(selection.anchorNode)}:${selection.anchorOffset} -> ${describe(selection.focusNode)}:${selection.focusOffset}`
				: "null",
		};
	});
	return { ...observed, s2: report?.s2 ?? null };
}

function nextStep(
	options: FuzzRunOptions,
	rng: ReturnType<typeof createFuzzRng>,
	i: number,
	report: FuzzCheckReport,
): FuzzStep {
	if (options.replay) {
		return options.replay[i]!;
	}
	if (options.forceFailAt === i) {
		return { i, kind: "force-fail", args: {} };
	}
	return {
		i,
		...generateAction(rng, {
			seed: options.seed,
			i,
			blocks: report.blocks,
			actionSet: options.actionSet,
		}),
	};
}

async function runStep(
	page: Page,
	step: FuzzStep,
	previous: FuzzCheckReport,
	pageErrors: string[],
): Promise<{ report: FuzzCheckReport | null; verdict: FuzzVerdict }> {
	try {
		await executeAction(page, step);
	} catch (error) {
		return {
			report: null,
			verdict: { check: "action", details: String(error) },
		};
	}
	const report = await settleAndCheck(page);
	if (pageErrors.length > 0) {
		return {
			report,
			verdict: { check: "page-error", details: pageErrors.splice(0) },
		};
	}
	return { report, verdict: evaluateFuzzReport(report, previous) };
}

/**
 * Greedy one-pass shrink (§3.15 SHOULD, not gated): drop each step, last
 * first, and keep the drop when a fresh replay still fails the same check
 * on its final step. Opt-in (`PEN_FUZZ_SHRINK=1`): every probe reloads.
 */
export async function shrinkFailure(
	s: ScenarioApi,
	page: Page,
	trace: FuzzTrace,
): Promise<FuzzTrace> {
	const target = trace.failure;
	if (!target || target.step < 0) {
		return trace;
	}
	let best = trace;
	for (let index = best.steps.length - 2; index >= 0; index -= 1) {
		const candidate = best.steps.filter(
			(_, position) => position !== index,
		);
		const probe = await runFuzzSession(s, page, {
			...best,
			steps: candidate.length,
			replay: candidate,
		});
		if (
			probe.failure?.check === target.check &&
			probe.failure.step === candidate.length - 1
		) {
			best = probe;
		}
	}
	return best;
}

/**
 * One seeded (or replayed) run on a freshly loaded fixture. Never throws on
 * an invariant failure: the trace carries it, so the caller can write it.
 */
export async function runFuzzSession(
	s: ScenarioApi,
	page: Page,
	options: FuzzRunOptions,
): Promise<FuzzTrace> {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await s.load(options.fixture);
	const rng = createFuzzRng(options.seed);
	const stepCount = options.replay ? options.replay.length : options.steps;
	const trace: FuzzTrace = {
		seed: options.seed,
		engine: options.engine,
		fixture: options.fixture,
		opCount: stepCount,
		forceFailAt: options.forceFailAt,
		steps: [],
		failure: null,
		record: null,
		dom: null,
	};
	let previous = await settleAndCheck(page);
	const baseline = evaluateFuzzReport(previous, null);
	if (baseline) {
		trace.failure = { step: -1, ...baseline };
		trace.dom = await domSnapshot(page, previous);
		return trace;
	}
	for (let i = 0; i < stepCount; i += 1) {
		const step = nextStep(options, rng, i, previous);
		trace.steps.push(step);
		const { report, verdict } = await runStep(
			page,
			step,
			previous,
			pageErrors,
		);
		if (verdict) {
			trace.failure = { step: i, ...verdict };
			trace.record = await page.evaluate(
				() => window.__penConformance.selectionRecord,
			);
			trace.dom = await domSnapshot(page, report);
			return trace;
		}
		previous = report!;
	}
	return trace;
}
