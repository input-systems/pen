import { readAllSuggestions } from "@input/pen-ai";
import { getSearchController } from "@input/pen-search";
import { describe, expect, it } from "vitest";
import { installCacheSwitch, type CacheSwitch } from "../cacheAudit/caches";
import { createAuditEditor, type AuditEditor } from "../cacheAudit/fixture";
import { loadAuditInternals } from "../cacheAudit/internals";
import { AUDIT_OPS, createAuditOps } from "../cacheAudit/ops";
import { decide, renderCacheAudit } from "../cacheAudit/report";
import { AUDIT_CACHES, runCacheAudit } from "../cacheAudit/run";

const SIZE = 100;
const NAIVE_CACHES = ["A", "B", "C", "D", "E", "F", "G"] as const;

function observable(audit: AuditEditor) {
	const { editor, notifier } = audit;
	return {
		preorder: editor.documentState.preorderBlockIds(),
		children: editor.documentState.blockOrder.map((id) => editor.documentState.childrenOf(id)),
		decorations: editor
			.getDecorations()
			// Suggestion ids are random per editor; everything else must match.
			.decorations.map((decoration) => JSON.stringify(decoration).replace(/"data-suggestion-id":"[^"]*"/, ""))
			.sort(),
		suggestions: readAllSuggestions(editor).map((suggestion) => suggestion.blockId),
		matches: getSearchController(editor)?.getState().matches.map((match) => match.blockId),
		segments: notifier.getListSegments(null),
	};
}

describe("cache audit (simplification plan Phase 1)", () => {
	it("runs every naive variant to the same observable state as the incremental caches", async () => {
		const internals = await loadAuditInternals();
		const incremental = await createAuditEditor(SIZE, internals);
		const naive = await createAuditEditor(SIZE, internals);
		const switches: CacheSwitch[] = NAIVE_CACHES.map((cache) => installCacheSwitch(cache, naive, internals));
		try {
			expect(observable(incremental).matches).toEqual(["scale-block-42"]);
			for (const cacheSwitch of switches) cacheSwitch.setMode("naive");
			const incrementalOps = createAuditOps(incremental.editor, SIZE);
			const naiveOps = createAuditOps(naive.editor, SIZE);
			for (const op of AUDIT_OPS) {
				for (let run = 0; run < 3; run += 1) {
					incrementalOps.run(op);
					naiveOps.run(op);
				}
				expect(observable(naive), op).toEqual(observable(incremental));
			}
		} finally {
			for (const cacheSwitch of switches) cacheSwitch.dispose();
			incremental.destroy();
			naive.destroy();
		}
	});

	it("measures and renders every cache", async () => {
		const internals = await loadAuditInternals();
		const cells = await runCacheAudit(internals, { sizes: [SIZE], caches: AUDIT_CACHES, runs: 1 });
		expect(new Set(cells.map((cell) => cell.cache))).toEqual(new Set(AUDIT_CACHES));
		for (const cell of cells) {
			expect(Number.isFinite(cell.naive.componentMedian), `${cell.cache} ${cell.row}`).toBe(true);
		}
		// The rule is evaluated at 10k only.
		expect(decide(cells)).toEqual([]);
		const markdown = renderCacheAudit(cells, {
			date: "2026-01-01",
			machine: "test",
			runs: 1,
			loadBefore: "0",
			loadAfter: "0",
			notes: {},
			findings: [],
		});
		expect(markdown).toContain("## H. Overlay range and inline-facts caches");
	}, 60_000);
});
