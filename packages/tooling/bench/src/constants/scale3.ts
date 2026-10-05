/**
 * SCALE3 (`spec/rules/scale.md`): axes, stack, and committed
 * baselines for the realistic-stack keystroke workload.
 *
 * Machine class that produced the measured medians:
 *   macos-arm64 (darwin 25, Apple Silicon, local isolated `tsx` run)
 * CI machine class the isolated job uses:
 *   github-actions-ubuntu-latest (`.github/workflows/bench.yml`)
 *
 * `measuredP50Ms` is the recorded median. `gateP50Ms` is that number plus
 * slack for the CI class — the CH8 comparison target, not an invented
 * frame budget. Update both in the same PR and say why.
 *
 * Recorded 2026-08-27, after the commit path stopped re-reading the whole
 * document on every apply (SCALE2). Every median now sits under the 0.5ms
 * attribution floor (`ENVELOPE_GATE_MIN_SIGNAL_MS`), so the ratio between
 * two of these points is timer noise and is not gated. The gate is a flat
 * 2ms instead: 4x the attribution floor, and below the 3.58-3.76ms the
 * 1000-block rungs cost before the fix, so per-document commit work fails
 * here rather than passing on the 25-50ms slack it used to carry. The
 * 100-block rung carries the same 2ms rather than a tighter number —
 * it cost 0.48ms before the fix, so any gate that could catch a
 * regression there would sit under the floor and gate on timer noise.
 */

export const SCALE3_MACHINE_CLASS =
	"macos-arm64 (darwin 25, Apple Silicon); CI: github-actions-ubuntu-latest";

/** Current measured envelope for `@input/pen-bench` (SCALE1 ladder 100 / 1_000 / 5_000; F.1 owns 5_000). */
export const SCALE3_DOCUMENT_SIZE_POINTS = [100, 1000] as const;

/**
 * Shipped stack count (4 default-preset + 5 no-op plus-extensions) and the
 * SCALE2 "+8 no-op decorating extensions" point.
 */
export const SCALE3_EXTENSION_COUNT_POINTS = [9, 17] as const;

export const SCALE3_DECORATION_COUNT_POINTS = [0, 256] as const;

/**
 * Remote-caret decorations on the multiplayer stand-in: decoration cost,
 * not N synced Y.Docs. Peer-count scaling is the synced-peer axis below.
 */
export const SCALE3_REMOTE_CARET_COUNT_POINTS = [0, 8] as const;

/**
 * Synced peers (W5.R9): real forked `Y.Doc`s at the 1,000-block point, each
 * with the real `multiplayerExtension`, one typist fanning a keystroke out
 * to the others. Gated on counts (`baselines/scale3-peers.json`); its
 * clocks are recorded, never gated (CH8), because fan-out grows with n.
 */
export const SCALE3_SYNCED_PEER_POINTS = [2, 4, 8] as const;

/**
 * Setup-only wait for presence to settle: one `LOCAL_PRESENCE_MIN_INTERVAL_MS`
 * (50ms in `@input/pen-multiplayer`) plus margin, outside every clock.
 */
export const LOCAL_PRESENCE_SETTLE_MS = 80;

const SCALE3_DEFAULT_PRESET_EXTENSIONS = [
	"tools",
	"delta-stream",
	"undo",
	"rich-text-shortcuts",
] as const;

/**
 * Stand-ins for the packages hosts add on top of the default preset.
 * They keep the shipped names and the observe/decoration hooks so the
 * commit path pays extension-list cost. They do not import `@input/pen-ai`
 * (or suggestions/autocomplete/search/multiplayer): activating those
 * controllers, model adapters, and analysis caches would measure AI
 * runtime, not the per-keystroke dispatch SCALE3 exists to see.
 */
export const SCALE3_PLUS_EXTENSIONS = [
	"ai",
	"ai-suggestions",
	"ai-autocomplete",
	"search",
	"multiplayer",
] as const;

export const SCALE3_SHIPPED_STACK = [
	...SCALE3_DEFAULT_PRESET_EXTENSIONS,
	...SCALE3_PLUS_EXTENSIONS,
] as const;

export type Scale3Axis =
	| "document-size"
	| "extension-count"
	| "decoration-count"
	| "remote-caret-count"
	| "synced-peer-count";

export interface Scale3AxisSpec {
	axis: Scale3Axis;
	points: readonly [number, number, ...number[]];
	unit: string;
}

export const SCALE3_AXES: readonly Scale3AxisSpec[] = [
	{
		axis: "document-size",
		points: SCALE3_DOCUMENT_SIZE_POINTS,
		unit: "blocks",
	},
	{
		axis: "extension-count",
		points: SCALE3_EXTENSION_COUNT_POINTS,
		unit: "extensions",
	},
	{
		axis: "decoration-count",
		points: SCALE3_DECORATION_COUNT_POINTS,
		unit: "decorations",
	},
	{
		axis: "remote-caret-count",
		points: SCALE3_REMOTE_CARET_COUNT_POINTS,
		unit: "remote-carets",
	},
	{
		axis: "synced-peer-count",
		points: SCALE3_SYNCED_PEER_POINTS,
		unit: "synced-peers",
	},
];

export interface Scale3Baseline {
	id: string;
	axis: Scale3Axis;
	/** The isolated point this bench reports; the other point lives on the paired bench. */
	point: number;
	measuredP50Ms: number;
	gateP50Ms: number;
	machineClass: string;
}

/**
 * The measured points per axis, at least two. The 1000-block shipped stack
 * is the shared low point for extension / decoration / remote-caret count;
 * the synced-peer axis is gated on counts at three points.
 */
export const SCALE3_AXIS_BENCHES: Record<
	Scale3Axis,
	readonly [string, string, ...string[]]
> = {
	"document-size": [
		"scale3.keystroke.realistic-stack.document-size.100",
		"scale3.keystroke.realistic-stack.document-size.1000",
	],
	"extension-count": [
		"scale3.keystroke.realistic-stack.document-size.1000",
		"scale3.keystroke.realistic-stack.extension-count.plus8",
	],
	"decoration-count": [
		"scale3.keystroke.realistic-stack.document-size.1000",
		"scale3.keystroke.realistic-stack.decoration-count.256",
	],
	"remote-caret-count": [
		"scale3.keystroke.realistic-stack.document-size.1000",
		"scale3.keystroke.realistic-stack.remote-caret-count.8",
	],
	"synced-peer-count": [
		"scale3.keystroke.synced-peers.2",
		"scale3.keystroke.synced-peers.4",
		"scale3.keystroke.synced-peers.8",
	],
};

export const SCALE3_BASELINES: readonly Scale3Baseline[] = [
	{
		id: "scale3.keystroke.realistic-stack.document-size.100",
		axis: "document-size",
		point: 100,
		measuredP50Ms: 0.04,
		gateP50Ms: 2,
		machineClass: SCALE3_MACHINE_CLASS,
	},
	{
		id: "scale3.keystroke.realistic-stack.document-size.1000",
		axis: "document-size",
		point: 1000,
		measuredP50Ms: 0.06,
		gateP50Ms: 2,
		machineClass: SCALE3_MACHINE_CLASS,
	},
	{
		id: "scale3.keystroke.realistic-stack.extension-count.plus8",
		axis: "extension-count",
		point: 17,
		measuredP50Ms: 0.06,
		gateP50Ms: 2,
		machineClass: SCALE3_MACHINE_CLASS,
	},
	{
		id: "scale3.keystroke.realistic-stack.decoration-count.256",
		axis: "decoration-count",
		point: 256,
		measuredP50Ms: 0.05,
		gateP50Ms: 2,
		machineClass: SCALE3_MACHINE_CLASS,
	},
	{
		id: "scale3.keystroke.realistic-stack.remote-caret-count.8",
		axis: "remote-caret-count",
		point: 8,
		measuredP50Ms: 0.06,
		gateP50Ms: 2,
		machineClass: SCALE3_MACHINE_CLASS,
	},
];

export function getScale3Baseline(id: string): Scale3Baseline {
	const baseline = SCALE3_BASELINES.find((entry) => entry.id === id);
	if (!baseline) {
		throw new Error(`SCALE3 baseline missing for ${id}`);
	}
	return baseline;
}

/**
 * SCALE2: eight no-op decorating extensions vs the 1000-block shipped
 * stack, compared on the same run. 2× covers dispatch walking eight
 * extra hooks on a noisy runner. The 15ms floor covers a cheap base
 * median, where a pure ratio would treat jitter as a regression.
 *
 * This is not a decoration-identity proof. Scoping lives in core.
 */
export const SCALE2_PLUS8_TOLERANCE_RATIO = 2;
export const SCALE2_PLUS8_TOLERANCE_FLOOR_MS = 15;
export const SCALE2_PLUS8_BASE_ID = SCALE3_AXIS_BENCHES["extension-count"][0];
export const SCALE2_PLUS8_ID = SCALE3_AXIS_BENCHES["extension-count"][1];

export function scale2Plus8GateMs(baseP50Ms: number): number {
	const raw = Math.max(
		baseP50Ms * SCALE2_PLUS8_TOLERANCE_RATIO,
		baseP50Ms + SCALE2_PLUS8_TOLERANCE_FLOOR_MS,
	);
	return Math.round(raw * 100) / 100;
}

export interface Scale2Plus8ToleranceResult {
	ok: boolean;
	plus8P50Ms: number;
	baseP50Ms: number;
	gateP50Ms: number;
}

export function compareScale2Plus8Tolerance(
	plus8P50Ms: number,
	baseP50Ms: number,
): Scale2Plus8ToleranceResult {
	const gateP50Ms = scale2Plus8GateMs(baseP50Ms);
	return {
		ok: plus8P50Ms <= gateP50Ms,
		plus8P50Ms,
		baseP50Ms,
		gateP50Ms,
	};
}

export function formatScale2Plus8Tolerance(
	result: Scale2Plus8ToleranceResult,
): string {
	if (result.ok) {
		return "SCALE2 plus8 decorating extensions: within tolerance";
	}
	return `SCALE2 plus8 decorating extensions exceeded tolerance: plus8 median ${result.plus8P50Ms.toFixed(2)}ms > gate ${result.gateP50Ms.toFixed(2)}ms (base stack ${result.baseP50Ms.toFixed(2)}ms)`;
}
