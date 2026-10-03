import { createEditor as createCoreEditor } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { CommitEvent, Editor, TextStreamWriter } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { undoExtension } from "../undoExtension";

const undoOnlyPreset = {
	resolve() {
		return { extensions: [undoExtension()] };
	},
};

const NIGHTLY = Boolean(process.env.PEN_FUZZ_NIGHTLY);
const SEED_INFO = parseFuzzSeed(process.env.PEN_FUZZ_SEED);
const SEED = SEED_INFO.numeric;
const STEP_COUNT = resolveOpCount();

// Every nightly seed that failed this suite between runs 33716069126 and
// 36991548406, replayed at the nightly step count. Each failed with
// "apply no-op" on a splice that rewrote a character with the same character
// (2862979418, run 36991548406, at commit 771: " " over " " at 11..12): one
// delete and one insert in the CRDT, so one commit, with the text unchanged.
const PINNED_SEEDS = [
	2862979418, 2331466616, 270714555, 547392220, 653485406, 1033193572,
	1669096992, 1705328024, 1781895020, 1820414097, 1976218039, 2095813717,
	2257784941, 2371651956, 2666731515, 2692182216, 2865217711, 3997860482,
] as const;
const PINNED_STEP_COUNT = 2_000;
const YIELD_EVERY_STEPS = 100;

const ACTIONS = ["apply", "remote", "undo", "redo", "stream"] as const;
type Action = (typeof ACTIONS)[number];

class Rng {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0;
	}

	next(): number {
		this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
		return this.state / 0x100000000;
	}

	int(max: number): number {
		if (max <= 0) return 0;
		return Math.floor(this.next() * max);
	}

	pick<T>(items: readonly T[]): T {
		return items[this.int(items.length)]!;
	}
}

function parseFuzzSeed(raw: string | undefined): { raw: string; numeric: number } {
	const source = raw && raw.length > 0 ? raw : "20260820";
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

function resolveOpCount(): number {
	const override = Number(process.env.PEN_FUZZ_OP_COUNT);
	if (Number.isFinite(override) && override > 0) return Math.floor(override);
	return NIGHTLY ? 2_000 : 200;
}

interface PropertyRun {
	seed: number;
	raw: string;
	steps: number;
}

type TestYTextLike = {
	insert(offset: number, text: string): void;
	readonly length: number;
};

type TestRawDocLike = {
	getMap(name: "blocks"): {
		get(key: string): { get(key: "content"): TestYTextLike } | undefined;
	};
};

function ydocOf(doc: unknown): Y.Doc {
	return (doc as { ydoc: Y.Doc }).ydoc;
}

function stateMoved(transaction: Y.Transaction): boolean {
	for (const [client, clock] of transaction.afterState) {
		if (transaction.beforeState.get(client) !== clock) {
			return true;
		}
	}
	return false;
}

// I1 counts durable writes, not visible text. A splice that rewrites a
// character with the same character deletes one item and inserts another, so
// the text is unchanged while the document is not. A transaction wrote when it
// inserted (the state vector moved) or deleted (its delete set is not empty).
// The returned function reports whether any write landed since its last call.
function watchWrites(editor: Editor): () => boolean {
	let wrote = false;
	ydocOf(editor.internals.crdtDoc).on(
		"afterTransaction",
		(transaction: Y.Transaction) => {
			if (transaction.deleteSet.clients.size > 0 || stateMoved(transaction)) {
				wrote = true;
			}
		},
	);
	return () => {
		const result = wrote;
		wrote = false;
		return result;
	};
}

function expectedSource(action: Action): CommitEvent["source"] {
	switch (action) {
		case "apply":
			return "apply";
		case "remote":
			return "remote";
		case "undo":
			return "undo";
		case "redo":
			return "redo";
		case "stream":
			return "stream";
		default: {
			const _exhaustive: never = action;
			return _exhaustive;
		}
	}
}

async function runCommitEventProperty(property: PropertyRun): Promise<void> {
	const editor = createCoreEditor({
		schema: defaultSchema,
		preset: undoOnlyPreset,
	});
	await editor.whenReady();
	const blockId = editor.firstBlock()!.id;
	const adapter = editor.internals.adapter;
	const editorDoc = editor.internals.crdtDoc;
	const remoteDoc = adapter.loadDocument(adapter.encodeState(editorDoc));

	const label = (action: string, extra: string): string =>
		`seed=${property.seed} (${property.raw}) ${action} ${extra}`;
	const takeWrites = watchWrites(editor);

	const commits: CommitEvent[] = [];
	editor.on("commit", (event) => {
		commits.push(event);
	});

	const stream: { writer: TextStreamWriter | null } = { writer: null };
	const rng = new Rng(property.seed);
	let lastCommitId = 0;
	const seenSources = new Set<CommitEvent["source"]>();

	const catchUpRemote = () => {
		adapter.applyUpdate(
			remoteDoc,
			adapter.encodeUpdate(
				editorDoc,
				Y.encodeStateVector(ydocOf(remoteDoc)),
			),
		);
	};

	const remoteText = (): TestYTextLike => {
		const text = adapter
			.raw<TestRawDocLike>(remoteDoc)
			.getMap("blocks")
			.get(blockId)
			?.get("content");
		if (!text) {
			throw new Error(`Missing remote text for ${blockId}`);
		}
		return text;
	};

	const run = (action: Action): void => {
		if (action === "undo" && !editor.undoManager.canUndo()) {
			return;
		}
		if (action === "redo" && !editor.undoManager.canRedo()) {
			return;
		}

		takeWrites();
		const commitCount = commits.length;

		if (action === "apply") {
			const length = editor.getBlock(blockId)?.length() ?? 0;
			editor.apply(
				[
					{
						type: "splice-text",
						blockId,
						from: rng.int(length + 1),
						to: rng.int(length + 1),
						insert: rng.pick(["a", "bb", " "]),
					},
				],
				{ origin: "user" },
			);
			editor.undoManager.stopCapturing();
			catchUpRemote();
		} else if (action === "remote") {
			catchUpRemote();
			const text = remoteText();
			adapter.transact(
				remoteDoc,
				() => {
					text.insert(rng.int(text.length + 1), rng.pick(["r", "rr"]));
				},
				"collaborator",
			);
			adapter.applyUpdate(
				editorDoc,
				adapter.encodeUpdate(
					remoteDoc,
					Y.encodeStateVector(ydocOf(editorDoc)),
				),
			);
		} else if (action === "undo") {
			editor.undoManager.undo();
			catchUpRemote();
		} else if (action === "redo") {
			editor.undoManager.redo();
			catchUpRemote();
		} else if (action === "stream") {
			if (!stream.writer) {
				stream.writer = editor.openTextStream(
					{ blockId },
					{
						origin: { type: "ai", groupId: "i1-stream" },
						flushIntervalMs: 100,
					},
				);
			}
			stream.writer.append(rng.pick(["s", "ss"]));
			stream.writer.flush();
			catchUpRemote();
		} else {
			const _exhaustive: never = action;
			return _exhaustive;
		}

		const changed = takeWrites();
		const produced = commits.slice(commitCount);
		if (!changed) {
			expect(produced, label(action, "no-op")).toHaveLength(0);
			return;
		}

		expect(produced, label(action, "state change")).toHaveLength(1);
		const event = produced[0]!;
		expect(event.commitId).toBeGreaterThan(lastCommitId);
		expect(event.summary).toBeTruthy();
		expect(event.source).toBe(expectedSource(action));
		lastCommitId = event.commitId;
		seenSources.add(event.source);
	};

	run("apply");
	run("remote");
	run("apply");
	run("undo");
	run("redo");
	run("stream");

	expect([...seenSources].sort()).toEqual(
		["apply", "redo", "remote", "stream", "undo"].sort(),
	);

	// Yield periodically so Vitest can ack the worker: a long synchronous loop
	// outruns birpc's 60s window on CI and fails the run after the assertions
	// pass (same fix as the an-fuzz loop).
	for (let step = 0; step < property.steps; step += 1) {
		run(rng.pick(ACTIONS));
		if (step % YIELD_EVERY_STEPS === YIELD_EVERY_STEPS - 1) {
			await new Promise<void>((resolve) => {
				setImmediate(resolve);
			});
		}
	}

	stream.writer?.close();
	for (const event of commits) {
		expect(event.summary).toBeTruthy();
	}
	for (let index = 1; index < commits.length; index += 1) {
		expect(commits[index]!.commitId).toBeGreaterThan(
			commits[index - 1]!.commitId,
		);
	}

	editor.destroy();
}

describe("@input/pen-undo commit event one-event property", () => {
	it("I1: random apply/remote/undo/redo/stream-flush sequences emit one commit per state change", async () => {
		await runCommitEventProperty({
			seed: SEED,
			raw: SEED_INFO.raw,
			steps: STEP_COUNT,
		});
	});

	it.each(PINNED_SEEDS)(
		"I1: pinned nightly seed %i replays clean at the nightly step count",
		async (seed) => {
			await runCommitEventProperty({
				seed,
				raw: `pinned-${seed}`,
				steps: PINNED_STEP_COUNT,
			});
		},
	);

	it("I1: a splice that rewrites a character with the same character is one commit", async () => {
		const editor = createCoreEditor({
			schema: defaultSchema,
			preset: undoOnlyPreset,
		});
		await editor.whenReady();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "splice-text", blockId, from: 0, to: 0, insert: "a b" }],
			{ origin: "user" },
		);
		const takeWrites = watchWrites(editor);
		const commits: CommitEvent[] = [];
		editor.on("commit", (event) => {
			commits.push(event);
		});

		editor.apply(
			[{ type: "splice-text", blockId, from: 1, to: 2, insert: " " }],
			{ origin: "user" },
		);

		expect(editor.getBlock(blockId)?.textContent()).toBe("a b");
		expect(takeWrites()).toBe(true);
		expect(commits).toHaveLength(1);
		expect(commits[0]!.summary.blockText).toEqual([
			{
				blockId,
				splices: [{ from: 1, to: 2, insertLength: 1 }],
				formatRanges: [],
			},
		]);
		editor.destroy();
	});

	it("hyphenated nightly seeds hash instead of collapsing to 0", () => {
		expect(Number("99-1-1690000000")).toBeNaN();
		expect(parseFuzzSeed("99-1-1690000000").numeric).not.toBe(0);
		expect(parseFuzzSeed("99-1-1690000000").numeric).not.toBe(
			parseFuzzSeed("99-1-1690000001").numeric,
		);
		expect(parseFuzzSeed("42").numeric).toBe(42);
		expect(parseFuzzSeed(undefined).numeric).toBe(20260820);
	});

	it("seed reproduces the action-prefix", () => {
		const rng = new Rng(SEED);
		const prefix = Array.from({ length: 16 }, () => rng.pick(ACTIONS));
		console.log(
			`i1 fingerprint seed=${SEED} raw=${SEED_INFO.raw} nightly=${NIGHTLY} steps=${STEP_COUNT} prefix=${prefix.join(",")}`,
		);
		const replay = new Rng(SEED);
		expect(Array.from({ length: 16 }, () => replay.pick(ACTIONS))).toEqual(
			prefix,
		);
		const other = new Rng((SEED + 1) >>> 0);
		expect(
			Array.from({ length: 16 }, () => other.pick(ACTIONS)),
		).not.toEqual(prefix);
	});
});
