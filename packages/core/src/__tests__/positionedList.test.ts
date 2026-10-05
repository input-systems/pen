import { describe, expect, it } from "vitest";
import { PositionedList } from "../editor/positionedList";

/** Small deterministic PRNG so a failure names its seed. */
function mulberry32(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("PositionedList (SCALE2)", () => {
	it("SCALE2: indexOf equals the array's indexOf after every splice, across tail re-indexes", () => {
		for (let seed = 1; seed <= 40; seed += 1) {
			const random = mulberry32(seed);
			const initial = Array.from({ length: 30 }, (_, k) => `b${k}`);
			const list = PositionedList.of([...initial])!;
			const naive = [...initial];
			let serial = 0;
			for (let step = 0; step < 300; step += 1) {
				const at = Math.floor(random() * (naive.length + 1));
				const deleteCount = Math.min(naive.length - at, Math.floor(random() * 3));
				const removing = naive.slice(at, at + deleteCount);
				// Sometimes re-insert what this splice removes: a move in place.
				const inserted =
					random() < 0.3
						? [...removing].reverse()
						: Array.from({ length: Math.floor(random() * 3) }, () => `n${(serial += 1)}`);
				expect(list.splice(at, deleteCount, inserted), `seed ${seed} step ${step}`).toEqual(removing);
				naive.splice(at, deleteCount, ...inserted);
				// Read a few positions between splices, as commits do.
				for (let read = 0; read < 3 && naive.length > 0; read += 1) {
					const id = naive[Math.floor(random() * naive.length)]!;
					expect(list.indexOf(id), `seed ${seed} step ${step} ${id}`).toBe(naive.indexOf(id));
				}
				for (const id of removing) {
					if (!naive.includes(id)) expect(list.indexOf(id)).toBe(-1);
				}
			}
			expect([...list.ids]).toEqual(naive);
			for (const id of naive) expect(list.indexOf(id)).toBe(naive.indexOf(id));
		}
	});

	it("SCALE2: refuses a splice that would list an id twice and changes nothing", () => {
		const list = PositionedList.of(["a", "b", "c"])!;
		expect(list.splice(1, 0, ["c"])).toBeNull();
		expect(list.splice(0, 1, ["x", "x"])).toBeNull();
		expect([...list.ids]).toEqual(["a", "b", "c"]);
		expect(list.indexOf("c")).toBe(2);
	});
});
