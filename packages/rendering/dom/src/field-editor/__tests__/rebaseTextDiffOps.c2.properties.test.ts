import { describe, expect, it } from "vitest";
import { computeAnchoredTextDiff } from "../textDiff";
import { composeText, runC2Case, type Composition, type Splice } from "./c2RebaseHarness";

/**
 * C2 property (W3.R14, D3): a composition rebased over the collaborator
 * deltas deferred while it ran equals two `Y.Doc`s applying both edits
 * concurrently, remote first. Honours PEN_FUZZ_NIGHTLY (20,000 cases, else
 * 300), PEN_FUZZ_SEED (numeric or a hyphenated nightly seed) and
 * PEN_FUZZ_OP_COUNT (cases).
 */

const NIGHTLY = Boolean(process.env.PEN_FUZZ_NIGHTLY);
const SEED_INFO = parseFuzzSeed(process.env.PEN_FUZZ_SEED);
const CASES = resolveCaseCount();

/** Repeats force ambiguous diffs; the mark and the astral pair exercise UTF-16. */
const ALPHABET = ["a", "a", "b", "́", "\u{1F600}"] as const;

type Model = "fresh" | "reconversion" | "recomposition";

function parseFuzzSeed(raw: string | undefined): { raw: string; numeric: number } {
	const source = raw && raw.length > 0 ? raw : "20261003";
	const asNumber = Number(source);
	if (Number.isFinite(asNumber)) {
		return { raw: source, numeric: asNumber >>> 0 };
	}
	let hash = 2166136261;
	for (let i = 0; i < source.length; i++) {
		hash ^= source.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return { raw: source, numeric: hash >>> 0 };
}

function resolveCaseCount(): number {
	const override = Number(process.env.PEN_FUZZ_OP_COUNT);
	if (Number.isFinite(override) && override > 0) return Math.floor(override);
	return NIGHTLY ? 20_000 : 300;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function int(random: () => number, min: number, max: number): number {
	return min + Math.floor(random() * (max - min + 1));
}

function token(random: () => number): string {
	return ALPHABET[int(random, 0, ALPHABET.length - 1)]!;
}

function tokens(random: () => number, min: number, max: number): string {
	let text = "";
	const count = int(random, min, max);
	for (let i = 0; i < count; i++) text += token(random);
	return text;
}

/** UTF-16 offsets that do not split a surrogate pair. */
function boundaries(text: string): number[] {
	const result = [0];
	let offset = 0;
	for (const codePoint of text) {
		offset += codePoint.length;
		result.push(offset);
	}
	return result;
}

function pick<T>(random: () => number, items: readonly T[]): T {
	return items[int(random, 0, items.length - 1)]!;
}

function composition(random: () => number, base: string, model: Model): Composition {
	const points = boundaries(base);
	if (model === "fresh" || points.length < 2) {
		const at = pick(random, points);
		return { at, deleteLength: 0, insert: tokens(random, 1, 3), startOffset: at };
	}
	const startIndex = int(random, 0, points.length - 2);
	const endIndex = int(random, startIndex + 1, points.length - 1);
	const at = points[startIndex]!;
	const end = points[endIndex]!;
	const insert = tokens(random, 1, 3);
	if (model === "reconversion") {
		return { at, deleteLength: end - at, insert, startOffset: at };
	}
	// Recomposition: the IME rewrites the word around a collapsed caret.
	const caret = points[int(random, startIndex, endIndex)]!;
	return { at, deleteLength: end - at, insert, startOffset: caret };
}

function remoteSplices(random: () => number, base: string): Splice[] {
	const splices: Splice[] = [];
	let text = base;
	const count = int(random, 0, 4);
	for (let i = 0; i < count; i++) {
		const points = boundaries(text);
		const startIndex = int(random, 0, points.length - 1);
		const endIndex = Math.min(points.length - 1, startIndex + int(random, 0, 2));
		const at = points[startIndex]!;
		const deleteLength = points[endIndex]! - at;
		const insert = tokens(random, 0, 2);
		if (deleteLength === 0 && insert.length === 0) continue;
		splices.push({ at, deleteLength, insert });
		text = text.slice(0, at) + insert + text.slice(at + deleteLength);
	}
	return splices;
}

/** Whether the anchored diff names the IME's own splice, not just its result. */
function diffIsTrueEdit(base: string, edit: Composition): boolean {
	const composed = composeText(base, edit);
	if (composed === base) return false;
	const ops = computeAnchoredTextDiff(base, composed, edit.startOffset);
	const deleted = ops.find((op) => op.type === "delete");
	const inserted = ops.find((op) => op.type === "insert");
	const at = (deleted ?? inserted)!.offset;
	return (
		at === edit.at &&
		(deleted?.type === "delete" ? deleted.length : 0) === edit.deleteLength &&
		(inserted?.type === "insert" ? inserted.text : "") === edit.insert
	);
}

describe("C2 rebase property", () => {
	it("C2: rebased composition equals two Y.Docs applying both edits concurrently", () => {
		const random = mulberry32(SEED_INFO.numeric);
		const label = `seed=${SEED_INFO.numeric} (${SEED_INFO.raw}) cases=${CASES}`;
		const models: Model[] = ["fresh", "reconversion", "recomposition"];
		const evaluated = new Map<Model, number>(models.map((model) => [model, 0]));
		let skipped = 0;
		for (let index = 0; index < CASES; index++) {
			const base = tokens(random, 0, 8);
			const model = pick(random, models);
			const edit = composition(random, base, model);
			const remote = remoteSplices(random, base);
			// The residual ambiguity C2 documents: a diff that explains the
			// result with a different splice than the IME's. Fresh input at a
			// caret is exact, so it is never skipped.
			if (!diffIsTrueEdit(base, edit)) {
				if (model === "fresh" && composeText(base, edit) !== base) {
					throw new Error(`${label} case ${index}: a fresh composition did not anchor at its caret (${JSON.stringify({ base, edit })})`);
				}
				skipped++;
				continue;
			}
			const outcome = runC2Case(base, edit, remote);
			const context = `${label} case ${index}: ${JSON.stringify({ base, model, edit, remote })}`;
			expect(outcome.rebased, context).toBe(outcome.oracle);
			expect(outcome.validationErrors, context).toEqual([]);
			evaluated.set(model, evaluated.get(model)! + 1);
		}
		console.log(`C2 property ${label}: evaluated ${JSON.stringify(Object.fromEntries(evaluated))}, skipped ${skipped}`);
		for (const model of models) {
			expect(evaluated.get(model), `${label}: model ${model} was exercised`).toBeGreaterThan(0);
		}
		expect(skipped, `${label}: ambiguity skips stay a minority`).toBeLessThan(CASES / 2);
	});
});
