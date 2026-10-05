import { createScanProbe, type ScanCounts } from "@input/pen-test";
import type { SelectionRecord } from "@input/pen-types";
import { installCacheSwitch, type AuditMode, type CacheId, type CacheSwitch } from "./caches";
import { createAuditEditor, type AuditEditor } from "./fixture";
import type { AuditInternals, AuditOverlayContributor, AuditOverlayFieldState } from "./internals";
import { AUDIT_OPS, createAuditOps, type AuditOp, type AuditOpRunner } from "./ops";

export const AUDIT_SIZES = [1_000, 10_000, 50_000] as const;
export const AUDIT_CACHES: readonly CacheId[] = ["A", "B", "C", "D", "E", "F", "G", "H"];
export const DEFAULT_RUNS = 31;
const WARMUP = 3;
const MODES: readonly AuditMode[] = ["incremental", "naive"];

/** H's rows: overlay paints rather than editor operations. */
export const OVERLAY_SCENARIOS = [
	"paint after keystroke",
	"paint after caret move",
	"repaint, D5 range over half the document",
	"repaint, block selection of every root block",
] as const;

export type OverlayScenario = (typeof OVERLAY_SCENARIOS)[number];
export type AuditRow = AuditOp | OverlayScenario;

export interface ModeStats {
	readonly opMin: number;
	readonly opMedian: number;
	readonly componentMin: number;
	readonly componentMedian: number;
	readonly counts: ScanCounts;
}

export interface AuditCell {
	readonly cache: CacheId;
	readonly size: number;
	readonly row: AuditRow;
	readonly runs: number;
	readonly incremental: ModeStats;
	readonly naive: ModeStats;
}

export interface AuditOptions {
	readonly sizes: readonly number[];
	readonly caches: readonly CacheId[];
	readonly runs: number;
	readonly onProgress?: (message: string) => void;
}

interface Sample {
	readonly opMs: number;
	readonly componentMs: number;
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function stats(samples: readonly Sample[], counts: ScanCounts): ModeStats {
	const op = samples.map((sample) => sample.opMs);
	const component = samples.map((sample) => sample.componentMs);
	return {
		opMin: Math.min(...op),
		opMedian: median(op),
		componentMin: Math.min(...component),
		componentMedian: median(component),
		counts,
	};
}

/** Alternates which mode runs first, so drift on a shared machine lands on both. */
function interleaved(run: number): readonly AuditMode[] {
	return run % 2 === 0 ? MODES : [...MODES].reverse();
}

function timeOps(
	ops: AuditOpRunner,
	cacheSwitch: CacheSwitch,
	op: AuditOp,
	runs: number,
): Record<AuditMode, Sample[]> {
	const samples: Record<AuditMode, Sample[]> = { incremental: [], naive: [] };
	for (let run = 0; run < WARMUP + runs; run += 1) {
		for (const mode of interleaved(run)) {
			cacheSwitch.setMode(mode);
			cacheSwitch.takeComponentMs();
			const start = performance.now();
			ops.run(op);
			const opMs = performance.now() - start;
			const componentMs = cacheSwitch.takeComponentMs();
			if (run >= WARMUP) samples[mode].push({ opMs, componentMs });
		}
	}
	cacheSwitch.setMode("incremental");
	return samples;
}

/** Durable counts: one warm op, then one counted op, per mode. */
function countOps(audit: AuditEditor, ops: AuditOpRunner, cacheSwitch: CacheSwitch, op: AuditOp): Record<AuditMode, ScanCounts> {
	const probe = createScanProbe(audit.editor);
	try {
		probe.selfTest();
		const counts = {} as Record<AuditMode, ScanCounts>;
		for (const mode of MODES) {
			cacheSwitch.setMode(mode);
			ops.run(op);
			probe.reset();
			ops.run(op);
			counts[mode] = probe.snapshot();
		}
		return counts;
	} finally {
		cacheSwitch.setMode("incremental");
		probe.dispose();
	}
}

function measureCache(
	cache: Exclude<CacheId, "H">,
	audit: AuditEditor,
	ops: AuditOpRunner,
	internals: AuditInternals,
	size: number,
	runs: number,
): AuditCell[] {
	const cacheSwitch = installCacheSwitch(cache, audit, internals);
	const cells: AuditCell[] = [];
	try {
		for (const op of AUDIT_OPS) {
			if (op === "keystroke" || op === "caret-move") ops.resetCaret();
			const samples = timeOps(ops, cacheSwitch, op, runs);
			const counts = countOps(audit, ops, cacheSwitch, op);
			cells.push({
				cache,
				size,
				row: op,
				runs,
				incremental: stats(samples.incremental, counts.incremental),
				naive: stats(samples.naive, counts.naive),
			});
		}
	} finally {
		cacheSwitch.dispose();
		ops.cleanup();
	}
	return cells;
}

const CARET_FIELD: AuditOverlayFieldState = {
	isEditing: true,
	isFocused: true,
	isComposing: false,
	readonly: false,
	mode: "single",
	editingCell: false,
	substitute: null,
};

/**
 * H: the selection overlay contributor's requests for one paint. Incremental
 * is one contributor kept across paints (inline facts per block revision, the
 * D5 range and O3 runs per record version and document generation); naive is
 * a fresh contributor per paint, which recomputes everything. Pure with
 * respect to the DOM (OV1), so no geometry stub is needed: measurement is a
 * later phase the contributor never reaches.
 */
function measureOverlay(audit: AuditEditor, ops: AuditOpRunner, internals: AuditInternals, size: number, runs: number): AuditCell[] {
	const { editor } = audit;
	const kept = internals.createSelectionOverlayContributor();
	const record = () => (editor as unknown as { selectionRecord: SelectionRecord }).selectionRecord;
	const paint = (contributor: AuditOverlayContributor, field: AuditOverlayFieldState): number => {
		const start = performance.now();
		contributor.requests({ editor, commits: [], selection: record(), field, caretMode: "auto" });
		return performance.now() - start;
	};
	const contributorFor = (mode: AuditMode) => (mode === "incremental" ? kept : internals.createSelectionOverlayContributor());
	const rootIds = [...editor.documentState.blockOrder];
	const half = rootIds[Math.floor(rootIds.length / 2)] as string;

	const scenarios: Record<OverlayScenario, { prepare(): void; before(): void; field: AuditOverlayFieldState }> = {
		"paint after keystroke": { prepare: ops.resetCaret, before: () => ops.run("keystroke"), field: CARET_FIELD },
		"paint after caret move": { prepare: ops.resetCaret, before: () => ops.run("caret-move"), field: CARET_FIELD },
		"repaint, D5 range over half the document": {
			prepare: () =>
				editor.selectTextRange({ blockId: rootIds[0] as string, offset: 0 }, { blockId: half, offset: 1 }),
			before: () => {},
			field: { ...CARET_FIELD, substitute: "block-surface-range" },
		},
		"repaint, block selection of every root block": {
			prepare: () => editor.selectBlocks(rootIds),
			before: () => {},
			field: CARET_FIELD,
		},
	};

	const cells: AuditCell[] = [];
	for (const row of OVERLAY_SCENARIOS) {
		const scenario = scenarios[row];
		scenario.prepare();
		const samples: Record<AuditMode, Sample[]> = { incremental: [], naive: [] };
		for (let run = 0; run < WARMUP + runs; run += 1) {
			scenario.before();
			for (const mode of interleaved(run)) {
				const ms = paint(contributorFor(mode), scenario.field);
				if (run >= WARMUP) samples[mode].push({ opMs: ms, componentMs: ms });
			}
		}
		const probe = createScanProbe(editor);
		const counts = {} as Record<AuditMode, ScanCounts>;
		try {
			// The kept contributor is warm from the timed runs; `before` is the
			// keystroke or caret move its next paint follows, if any.
			scenario.before();
			for (const mode of MODES) {
				probe.reset();
				paint(contributorFor(mode), scenario.field);
				counts[mode] = probe.snapshot();
			}
		} finally {
			probe.dispose();
		}
		cells.push({
			cache: "H",
			size,
			row,
			runs,
			incremental: stats(samples.incremental, counts.incremental),
			naive: stats(samples.naive, counts.naive),
		});
	}
	ops.cleanup();
	ops.resetCaret();
	return cells;
}

/** Every requested cache at every requested size, one editor per size. */
export async function runCacheAudit(internals: AuditInternals, options: AuditOptions): Promise<AuditCell[]> {
	const cells: AuditCell[] = [];
	for (const size of options.sizes) {
		options.onProgress?.(`building ${size} blocks`);
		const audit = await createAuditEditor(size, internals);
		const ops = createAuditOps(audit.editor, size);
		try {
			for (const cache of options.caches) {
				options.onProgress?.(`cache ${cache} at ${size} blocks`);
				cells.push(
					...(cache === "H"
						? measureOverlay(audit, ops, internals, size, options.runs)
						: measureCache(cache, audit, ops, internals, size, options.runs)),
				);
			}
			const unexpected = audit.unexpectedDiagnostics();
			if (unexpected.length > 0) {
				const codes = unexpected.map((event) => `${event.code}: ${event.message}`).join("; ");
				throw new Error(`cache audit: unexpected diagnostics at ${size} blocks: ${codes}`);
			}
		} finally {
			audit.destroy();
		}
	}
	return cells;
}
