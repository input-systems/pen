import { SCALE3_SYNCED_PEER_POINTS } from "./constants/scale3";
import { detectLoadSnapshot, detectMachineClass } from "./envelope/machine";
import { createScale3PeerSession } from "./fixtures/scale3Peers";

/**
 * SCALE3 synced-peer clocks (W5.R9): the typist's apply and the fan-out to
 * n − 1 peers, median of SAMPLES, beside an empty-relay floor (a fan-out
 * with nothing to send). Printed as the bench report; recorded, never gated
 * (CH8), because fan-out grows with n by construction. Counts are gated by
 * `src/__tests__/scale3.peers.test.ts`.
 */

const SAMPLES = 50;

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 1000) / 1000;
}

async function measure(peers: number) {
	const session = await createScale3PeerSession(peers);
	try {
		session.keystroke();
		const typist: number[] = [];
		const fanOut: number[] = [];
		const floor: number[] = [];
		for (let index = 0; index < SAMPLES; index += 1) {
			let start = performance.now();
			session.type();
			typist.push(performance.now() - start);
			start = performance.now();
			session.fanOut();
			fanOut.push(performance.now() - start);
			start = performance.now();
			session.fanOut();
			floor.push(performance.now() - start);
		}
		const fanOutP50Ms = median(fanOut);
		return {
			id: `scale3.keystroke.synced-peers.${peers}`,
			peers,
			typistP50Ms: median(typist),
			fanOutP50Ms,
			fanOutPerPeerP50Ms: Math.round((fanOutP50Ms / (peers - 1)) * 1000) / 1000,
			emptyRelayFloorP50Ms: median(floor),
			sampleSize: SAMPLES,
		};
	} finally {
		session.destroy();
	}
}

const rows = [];
for (const peers of SCALE3_SYNCED_PEER_POINTS) {
	rows.push(await measure(peers));
}
console.log(
	JSON.stringify(
		{
			rule: "SCALE3",
			axis: "synced-peer-count",
			statistic: "median",
			gated: false,
			machineClass: detectMachineClass(),
			load: detectLoadSnapshot(),
			recordedAt: new Date().toISOString().slice(0, 10),
			rows,
		},
		null,
		2,
	),
);
