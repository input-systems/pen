import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	main as checkDriftMain,
	parseDriftCheckArgs,
	runEnvelopeDriftCheck,
} from "../envelope/checkDrift";
import {
	loadCommittedEnvelope,
	type EnvelopeRecord,
} from "../envelope/compare";
import { withGatedRung } from "./envelopeRecordFixtures";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("SCALE1 named drift gate", () => {
	it("SCALE1: checkDrift exits non-zero by name when the fresh record is missing", async () => {
		const missing = join(tmpdir(), "pen-envelope-missing.json");
		const result = await runEnvelopeDriftCheck({ freshPath: missing });
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/SCALE1 envelope drift: fresh record missing/);
		expect(result.message).toContain(missing);
	});

	it("SCALE1: checkDrift exits non-zero by name when blocks-1000 count drifted", async () => {
		const committed = await loadCommittedEnvelope();
		const dir = await mkdtemp(join(tmpdir(), "pen-envelope-drift-"));
		const freshPath = join(dir, "envelope.json");
		await writeFile(
			freshPath,
			`${JSON.stringify(withCount(committed, "blocks-1000", 10), null, "\t")}\n`,
			"utf8",
		);

		const result = await runEnvelopeDriftCheck({ freshPath });
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(
			/blocks-1000 count 10 !== committed 1000/,
		);
	});

	it("SCALE1: checkDrift exits non-zero by name when a gated clock drifted", async () => {
		// A quiet record can leave every rung under the 0.5ms signal, so the
		// committed side is a copy with one gated rung.
		const committed = withGatedRung(
			await loadCommittedEnvelope(),
			"blocks-1000",
			2,
		);
		const gated = committed.points.find((point) => point.id === "blocks-1000");
		const dir = await mkdtemp(join(tmpdir(), "pen-envelope-clock-"));
		const committedPath = join(dir, "committed.json");
		const freshPath = join(dir, "envelope.json");
		const write = (file: string, record: EnvelopeRecord) =>
			writeFile(file, `${JSON.stringify(record, null, "\t")}\n`, "utf8");
		await write(committedPath, committed);
		await write(
			freshPath,
			withAttributed(committed, "blocks-1000", gated!.gateP50Ms! + 1),
		);

		const result = await runEnvelopeDriftCheck({ freshPath, committedPath });
		expect(result.exitCode).toBe(1);
		expect(result.message).toMatch(/blocks-1000 attributed/);
	});

	it("SCALE1: checkDrift main exits 1 when --fresh has no value", async () => {
		expect(() => parseDriftCheckArgs(["--fresh"])).toThrow(
			/missing value for --fresh/,
		);
		const code = await checkDriftMain(["--fresh"]);
		expect(code).toBe(1);
	});

	it("SCALE1: checkDrift CLI process exits non-zero by name for a missing file", () => {
		const missing = join(tmpdir(), "pen-envelope-cli-missing.json");
		const spawned = spawnDrift(["--fresh", missing]);
		expect(spawned.status).not.toBe(0);
		const output = `${spawned.stdout}${spawned.stderr}`;
		expect(output).toMatch(/SCALE1 envelope drift: fresh record missing/);
		expect(output).toContain(missing);
	});

	it("SCALE1: checkDrift CLI process exits non-zero by name for a drifted count", async () => {
		const committed = await loadCommittedEnvelope();
		const dir = await mkdtemp(join(tmpdir(), "pen-envelope-cli-"));
		const freshPath = join(dir, "envelope.json");
		await writeFile(
			freshPath,
			`${JSON.stringify(withCount(committed, "blocks-1000", 10), null, "\t")}\n`,
			"utf8",
		);

		const spawned = spawnDrift(["--fresh", freshPath]);
		expect(spawned.status).not.toBe(0);
		expect(`${spawned.stdout}${spawned.stderr}`).toMatch(
			/blocks-1000 count 10 !== committed 1000/,
		);
	});

	it("SCALE1: live published counts match the committed envelope", async () => {
		const result = await runEnvelopeDriftCheck();
		expect(result.exitCode).toBe(0);
		expect(result.message).toMatch(/counts match committed envelope/);
	});
});

function spawnDrift(args: string[]) {
	return spawnSync(
		"pnpm",
		["exec", "tsx", "src/envelope/checkDrift.cli.ts", ...args],
		{
			cwd: pkgRoot,
			encoding: "utf8",
			env: process.env,
		},
	);
}

function withCount(
	record: EnvelopeRecord,
	id: string,
	count: number,
): EnvelopeRecord {
	return {
		...record,
		points: record.points.map((point) =>
			point.id === id ? { ...point, count } : point,
		),
	};
}

function withAttributed(
	record: EnvelopeRecord,
	id: string,
	attributedP50Ms: number,
): EnvelopeRecord {
	return {
		...record,
		points: record.points.map((point) => {
			if (point.id !== id) {
				return point;
			}
			return {
				...point,
				measuredP50Ms: attributedP50Ms + point.floorP50Ms,
				attributedP50Ms,
			};
		}),
	};
}
