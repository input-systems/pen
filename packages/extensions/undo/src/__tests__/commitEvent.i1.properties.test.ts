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

function label(action: string, extra: string): string {
	return `seed=${SEED} (${SEED_INFO.raw}) ${action} ${extra}`;
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

function documentFingerprint(editor: Editor): string {
	return [...editor.blocks()]
		.map(
			(block) =>
				`${block.id}:${block.type}:${block.textContent({ resolved: true })}`,
		)
		.join("\n");
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

describe("@input/pen-undo commit event one-event property", () => {
	it("I1: random apply/remote/undo/redo/stream-flush sequences emit one commit per state change", async () => {
		const editor = createCoreEditor({
			schema: defaultSchema,
			preset: undoOnlyPreset,
		});
		await editor.whenReady();
		const blockId = editor.firstBlock()!.id;
		const adapter = editor.internals.adapter;
		const editorDoc = editor.internals.crdtDoc;
		const remoteDoc = adapter.loadDocument(adapter.encodeState(editorDoc));

		const commits: CommitEvent[] = [];
		editor.on("commit", (event) => {
			commits.push(event);
		});

		const stream: { writer: TextStreamWriter | null } = { writer: null };
		const rng = new Rng(SEED);
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

			// A state change is any CRDT change, not only a visible one: a
			// splice that replaces "a" with "a" changes no text but is a real
			// delete and insert, and I1 requires its one commit.
			const stateOf = () =>
				`${documentFingerprint(editor)}\n${Y.encodeStateVector(ydocOf(editorDoc)).join(",")}`;
			const before = stateOf();
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

			const changed = stateOf() !== before;
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

		for (let step = 0; step < STEP_COUNT; step += 1) {
			run(rng.pick(ACTIONS));
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
