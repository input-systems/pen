import { access } from "node:fs/promises";
import { SCALE1_MEASUREMENTS } from "../constants/scale1";
import { measurePublishedCount } from "../fixtures/envelope";
import {
	compareEnvelopeDrift,
	formatEnvelopeDrift,
	loadCommittedEnvelope,
	type EnvelopeRecord,
} from "./compare";

export interface DriftCheckResult {
	exitCode: number;
	message: string;
}

export function parseDriftCheckArgs(args: readonly string[]): {
	freshPath?: string;
} {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--fresh") {
			const value = args[i + 1];
			if (!value) {
				throw new Error("SCALE1 envelope drift: missing value for --fresh");
			}
			return { freshPath: value };
		}
		if (arg?.startsWith("--fresh=")) {
			const value = arg.slice("--fresh=".length);
			if (!value) {
				throw new Error("SCALE1 envelope drift: missing value for --fresh");
			}
			return { freshPath: value };
		}
	}
	return {};
}

/**
 * Named SCALE1 drift gate. Count drift always fails. Timing drift
 * stays same-class and gated. A missing fresh record exits 1.
 */
export async function runEnvelopeDriftCheck(
	args: { freshPath?: string; committedPath?: string } = {},
): Promise<DriftCheckResult> {
	if (args.freshPath) {
		try {
			await access(args.freshPath);
		} catch {
			return {
				exitCode: 1,
				message: `SCALE1 envelope drift: fresh record missing: ${args.freshPath}`,
			};
		}
		let fresh: EnvelopeRecord;
		try {
			fresh = await loadCommittedEnvelope(args.freshPath);
		} catch (error) {
			return {
				exitCode: 1,
				message: error instanceof Error ? error.message : String(error),
			};
		}
		const committed = await loadCommittedEnvelope(args.committedPath);
		const drift = compareEnvelopeDrift(fresh, committed);
		return {
			exitCode: drift.ok ? 0 : 1,
			message: formatEnvelopeDrift(drift),
		};
	}

	const committed = await loadCommittedEnvelope();
	const failures: string[] = [];
	for (const spec of SCALE1_MEASUREMENTS) {
		const live = measurePublishedCount(spec.id);
		const point = committed.points.find((entry) => entry.id === spec.id);
		if (!point) {
			failures.push(`${spec.id} missing from committed envelope`);
			continue;
		}
		if (live !== spec.point) {
			failures.push(
				`${spec.id} live count ${live} !== published point ${spec.point}`,
			);
		}
		if (live !== point.count) {
			failures.push(
				`${spec.id} live count ${live} !== committed ${point.count}`,
			);
		}
	}
	if (failures.length > 0) {
		return {
			exitCode: 1,
			message: `SCALE1 envelope drift exceeded tolerance: ${failures.join("; ")}`,
		};
	}
	return {
		exitCode: 0,
		message: "SCALE1 envelope drift: counts match committed envelope",
	};
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
	try {
		const result = await runEnvelopeDriftCheck(parseDriftCheckArgs(argv));
		console.error(result.message);
		return result.exitCode;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
