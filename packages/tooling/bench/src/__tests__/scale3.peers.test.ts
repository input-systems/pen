import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SCALE3_AXES, SCALE3_SYNCED_PEER_POINTS } from "../constants/scale3";
import {
	createScale3PeerSession,
	type Scale3PeerKeystrokeCounts,
} from "../fixtures/scale3Peers";

/**
 * SCALE3 synced-peer axis (W5.R9, W5.G4): one keystroke at 2, 4 and 8 synced
 * peers, gated on counts. Record with
 * RECORD_SCALE3_PEERS=1 SCALE3_PEERS_REASON="…".
 */

const BASELINE_PATH = resolve(import.meta.dirname, "../../baselines/scale3-peers.json");
const COUNT_FIELDS = [
	"updatesDelivered",
	"remoteCommits",
	"maxAffectedBlocksPerRemoteCommit",
	"remoteCaretsOnTypist",
	"peersObservingKeystroke",
] as const satisfies readonly (keyof Scale3PeerKeystrokeCounts)[];

type PeerRow = Scale3PeerKeystrokeCounts & { readonly id: string; readonly peers: number };
type PeerBaseline = {
	readonly rule: "SCALE3";
	readonly axis: "synced-peer-count";
	readonly fixture: string;
	readonly producedOn: string;
	readonly reason: string;
	readonly rows: readonly PeerRow[];
};

function rowId(peers: number): string {
	return `scale3.keystroke.synced-peers.${peers}`;
}

/** Field-by-field drift, each named `id.field: measured !== committed`. */
function compareRows(rows: readonly PeerRow[], committed: readonly PeerRow[]): string[] {
	const byId = new Map(committed.map((row) => [row.id, row]));
	const drift: string[] = [];
	for (const row of rows) {
		const base = byId.get(row.id);
		if (!base) {
			drift.push(`${row.id}: missing from the baseline`);
			continue;
		}
		for (const field of COUNT_FIELDS) {
			if (row[field] !== base[field]) {
				drift.push(`${row.id}.${field}: ${row[field]} !== ${base[field]}`);
			}
		}
	}
	return drift;
}

async function measure(peers: number): Promise<PeerRow> {
	const session = await createScale3PeerSession(peers);
	try {
		session.keystroke(); // warm-up: first-apply costs are not the axis
		return { id: rowId(peers), peers, ...session.keystroke() };
	} finally {
		session.destroy();
	}
}

describe("SCALE3 synced-peer axis", () => {
	it("SCALE3: the axis list includes synced-peer-count at 2, 4 and 8", () => {
		expect(SCALE3_AXES.find((spec) => spec.axis === "synced-peer-count")?.points).toEqual([
			...SCALE3_SYNCED_PEER_POINTS,
		]);
	});

	it("SCALE3: a keystroke at 2, 4 and 8 synced peers matches the committed counts", async () => {
		const rows: PeerRow[] = [];
		for (const peers of SCALE3_SYNCED_PEER_POINTS) {
			rows.push(await measure(peers));
		}
		if (process.env.RECORD_SCALE3_PEERS === "1") {
			const reason = process.env.SCALE3_PEERS_REASON;
			if (!reason) throw new Error("RECORD_SCALE3_PEERS needs SCALE3_PEERS_REASON");
			const baseline: PeerBaseline = {
				rule: "SCALE3",
				axis: "synced-peer-count",
				fixture: "createScale3PeerSession over createScale3YDoc(1000)",
				producedOn: new Date().toISOString().slice(0, 10),
				reason,
				rows,
			};
			writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, "\t")}\n`);
		}
		expect(existsSync(BASELINE_PATH), "SCALE3_PEERS_BASELINE_MISSING").toBe(true);
		const committed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as PeerBaseline;
		expect(compareRows(rows, committed.rows)).toEqual([]);
		// The baseline states what the fixture must observe, not what it happened to.
		for (const row of committed.rows) {
			expect(row).toMatchObject({
				updatesDelivered: row.peers - 1,
				remoteCommits: row.peers - 1,
				maxAffectedBlocksPerRemoteCommit: 1,
				remoteCaretsOnTypist: row.peers - 1,
				peersObservingKeystroke: row.peers,
			});
		}
	}, 120_000);

	it("SCALE3: a dropped delivery fails the synced-peer counts by field name", async () => {
		const committed = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as PeerBaseline;
		const session = await createScale3PeerSession(4);
		try {
			session.keystroke();
			const faulty: PeerRow = {
				id: rowId(4),
				peers: 4,
				...session.keystroke({ skip: new Set([2]) }),
			};
			const drift = compareRows([faulty], committed.rows);
			expect(drift).toContain("scale3.keystroke.synced-peers.4.updatesDelivered: 2 !== 3");
			expect(drift).toContain("scale3.keystroke.synced-peers.4.peersObservingKeystroke: 3 !== 4");
		} finally {
			session.destroy();
		}
	}, 60_000);
});
