/**
 * Shared metric store for the `?probe=render` instruments (SCALE6 counts).
 * Every probe adds into one flat map of dotted metric names; the scale-render
 * spec reads a window of it through `window.__penScaleProbe`.
 */

export const PROBE_ENABLED =
	new URLSearchParams(window.location.search).get("probe") === "render";

const metrics = new Map<string, number>();

export function bump(metric: string, by = 1): void {
	metrics.set(metric, (metrics.get(metric) ?? 0) + by);
}

export function resetMetrics(): void {
	metrics.clear();
}

export function readMetrics(): Record<string, number> {
	return Object.fromEntries([...metrics].sort(([a], [b]) => a.localeCompare(b, "en")));
}

/** Distinct values per metric, for "distinct blocks rendered/touched". */
const distinct = new Map<string, Set<string>>();

export function addDistinct(metric: string, value: string): void {
	const set = distinct.get(metric) ?? new Set<string>();
	set.add(value);
	distinct.set(metric, set);
}

export function readDistinct(): Record<string, number> {
	return Object.fromEntries([...distinct].map(([metric, set]) => [metric, set.size]));
}

export function resetDistinct(): void {
	distinct.clear();
}

/** One tracked block-level component render, attributed to its block (React P3, Vue P4). */
export function countBlockRender(blockId: unknown): void {
	bump("render.blockRenders");
	if (typeof blockId === "string") addDistinct("render.blocksRendered", blockId);
}
