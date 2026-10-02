import { detectLoadSnapshot, detectMachineClass } from "../envelope/machine";
import {
	SCALE3_REALISTIC_BLOCK_COUNTS,
	createScale3RealisticEditor,
	scale3RealisticKeystroke,
} from "./scale3Realistic";
import {
	scale3RealisticPointId,
	writeScale3RealisticClocks,
	type Scale3RealisticClock,
} from "./scale3RealisticBaseline";

/** Records SCALE3 realistic clocks next to the counts. Never compared (CH8). */
const WARMUP = 10;
const SAMPLES = 50;

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const load = detectLoadSnapshot();
const points: Scale3RealisticClock[] = [];
for (const blockCount of SCALE3_REALISTIC_BLOCK_COUNTS) {
	const editor = await createScale3RealisticEditor({ blockCount });
	for (let rep = 0; rep < WARMUP; rep += 1) scale3RealisticKeystroke(editor, blockCount);
	const samples: number[] = [];
	for (let rep = 0; rep < SAMPLES; rep += 1) {
		const start = performance.now();
		scale3RealisticKeystroke(editor, blockCount);
		samples.push(performance.now() - start);
	}
	editor.destroy();
	const p50Ms = Math.round(median(samples) * 100) / 100;
	points.push({ id: scale3RealisticPointId(blockCount), samples: SAMPLES, p50Ms });
	console.log(`${scale3RealisticPointId(blockCount)} p50 ${p50Ms}ms`);
}
writeScale3RealisticClocks({
	producedOn: new Date().toISOString().slice(0, 10),
	machine: detectMachineClass(),
	load,
	points,
});
