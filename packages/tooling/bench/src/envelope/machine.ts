import { cpus, loadavg, platform, release } from "node:os";

/** Machine load when a clock was recorded; `busy` makes the clock unpublishable. */
export interface EnvelopeLoadSnapshot {
	load1: number;
	ncpu: number;
	busy: boolean;
}

export type EnvelopeGateClass = "macos-arm64" | "linux" | "other";

/**
 * Busy when 1-minute load exceeds 35% of logical CPUs. That is enough
 * other work to make a wall-clock median unpublishable as an envelope.
 */
const BUSY_LOAD_FRACTION = 0.35;

/** The machine class a recorded clock is stamped with (CH8). */
export function detectMachineClass(): string {
	const arch = process.arch;
	const os = platform();
	if (os === "linux") {
		if (process.env.GITHUB_ACTIONS === "true") {
			return "linux-x64 (github-actions-ubuntu-latest)";
		}
		return `linux-${arch}`;
	}
	if (os === "darwin") {
		return `macos-${arch} (darwin ${release().split(".").slice(0, 1).join(".")}, Apple Silicon). Not the CI runner (github-actions-ubuntu-latest).`;
	}
	return `${os}-${arch}`;
}

/** The 1-minute load against logical CPUs, and whether it is too busy to record. */
export function detectLoadSnapshot(): EnvelopeLoadSnapshot {
	const ncpu = Math.max(1, cpus().length);
	const load1 = loadavg()[0] ?? 0;
	return {
		load1,
		ncpu,
		busy: load1 > ncpu * BUSY_LOAD_FRACTION,
	};
}

export function envelopeGateClass(machineClass: string): EnvelopeGateClass {
	const token = machineClass.trim().split(/[\s(]/, 1)[0] ?? "";
	if (token.startsWith("linux") || token.startsWith("github-actions")) {
		return "linux";
	}
	if (token.startsWith("macos") || token.startsWith("darwin")) {
		return "macos-arm64";
	}
	return "other";
}

export function sameEnvelopeGateClass(a: string, b: string): boolean {
	return envelopeGateClass(a) === envelopeGateClass(b);
}
