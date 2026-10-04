import { readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { CacheId } from "./caches";
import { loadAuditInternals } from "./internals";
import { CACHE_AUDIT_FINDINGS, CACHE_AUDIT_NOTES } from "./notes";
import { renderCacheAudit } from "./report";
import { AUDIT_CACHES, AUDIT_SIZES, DEFAULT_RUNS, runCacheAudit, type AuditCell } from "./run";

/**
 * `bench:caches`: measures caches A–H against their naive recompute, writes
 * the raw cells to `baselines/cache-audit.json` and renders CACHE-AUDIT.md.
 * `--sizes 1000,10000`, `--caches A,C`, `--runs 31`, `--out <path>` (`-`
 * prints instead of writing), `--from <json>` re-renders a recorded run.
 */
const DEFAULT_OUT = fileURLToPath(new URL("../../CACHE-AUDIT.md", import.meta.url));
const DEFAULT_JSON = fileURLToPath(new URL("../../baselines/cache-audit.json", import.meta.url));

interface AuditRecord {
	readonly date: string;
	readonly machine: string;
	readonly runs: number;
	readonly loadBefore: string;
	readonly loadAfter: string;
	readonly cells: readonly AuditCell[];
}

function list(value: string | undefined): string[] | null {
	return value ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : null;
}

function load(): string {
	return loadavg()
		.map((value) => value.toFixed(2))
		.join(" ");
}

async function measure(values: { sizes?: string; caches?: string; runs?: string }): Promise<AuditRecord> {
	const sizes = list(values.sizes)?.map(Number) ?? [...AUDIT_SIZES];
	const caches = (list(values.caches) as CacheId[] | null) ?? [...AUDIT_CACHES];
	const runs = values.runs ? Number(values.runs) : DEFAULT_RUNS;
	const loadBefore = load();
	const internals = await loadAuditInternals();
	const cells = await runCacheAudit(internals, {
		sizes,
		caches,
		runs,
		onProgress: (message) => process.stderr.write(`[bench:caches] ${message}\n`),
	});
	return {
		date: new Date().toISOString().slice(0, 10),
		machine: `${cpus()[0]?.model ?? "unknown CPU"}, ${cpus().length} cores, Node ${process.version}`,
		runs,
		loadBefore,
		loadAfter: load(),
		cells,
	};
}

const { values } = parseArgs({
	options: {
		sizes: { type: "string" },
		caches: { type: "string" },
		runs: { type: "string" },
		out: { type: "string" },
		json: { type: "string" },
		from: { type: "string" },
	},
});

const record: AuditRecord = values.from
	? (JSON.parse(readFileSync(values.from, "utf8")) as AuditRecord)
	: await measure(values);
const markdown = renderCacheAudit(record.cells, {
	...record,
	notes: CACHE_AUDIT_NOTES,
	findings: CACHE_AUDIT_FINDINGS,
});
const out = values.out ?? DEFAULT_OUT;
if (out === "-") {
	process.stdout.write(markdown);
} else {
	writeFileSync(out, markdown);
	process.stderr.write(`[bench:caches] wrote ${out}\n`);
	if (!values.from) {
		const json = values.json ?? DEFAULT_JSON;
		writeFileSync(json, `${JSON.stringify(record, null, "\t")}\n`);
		process.stderr.write(`[bench:caches] wrote ${json}\n`);
	}
}
process.exit(0);
