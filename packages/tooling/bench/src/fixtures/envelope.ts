import {
	createPeerHarness,
	createTestDocument,
	createTestEditor,
	createTwoPeerHarness,
	type PeerHarness,
} from "@input/pen-test";
import type { BlockHandle, DocumentOp } from "@input/pen-types";
import type { TestBlock, TestEditor } from "@input/pen-test";
import * as Y from "yjs";
import {
	SCALE1_LONG_BLOCK_CHARS,
	SCALE1_NESTING_DEPTH,
	SCALE1_PEER_COUNT,
	SCALE1_TABLE_COLS,
	SCALE1_TABLE_ROWS,
	assertNeverEnvelopeRung,
	type EnvelopeRungId,
} from "../constants/scale1";

export const ENVELOPE_LONG_BLOCK_ID = "envelope-long";
export const ENVELOPE_TABLE_BLOCK_ID = "envelope-table";

const seedUpdates = new Map<string, Uint8Array>();

export function envelopeBlockId(index: number): string {
	return `envelope-block-${index}`;
}

export function envelopeNestId(depth: number): string {
	return `envelope-nest-${depth}`;
}

export function generateBlockSpecs(count: number): TestBlock[] {
	const blocks: TestBlock[] = [];
	for (let index = 0; index < count; index++) {
		const type = blockTypeForIndex(index);
		const block: TestBlock = {
			id: envelopeBlockId(index),
			type,
			content: `Block ${index}`,
		};
		if (type === "heading") {
			block.props = { level: (Math.floor(index / 10) % 3) + 1 };
		}
		blocks.push(block);
	}
	return blocks;
}

export function generateLongBlockSpec(
	chars: number = SCALE1_LONG_BLOCK_CHARS,
): TestBlock[] {
	return [
		{
			id: ENVELOPE_LONG_BLOCK_ID,
			type: "paragraph",
			content: "A".repeat(chars),
		},
	];
}

export function createEnvelopeYDoc(rungId: EnvelopeRungId): Y.Doc {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, seedUpdate(rungId));
	return ydoc;
}

export function createEnvelopeEditor(rungId: EnvelopeRungId): TestEditor {
	if (rungId === "concurrentPeers-2") {
		throw new Error(
			"concurrentPeers-2 uses createEnvelopeCollaboration, not a single editor",
		);
	}
	return createTestEditor({ doc: createEnvelopeYDoc(rungId) });
}

export function createEnvelopeCollaboration(blockCount = 100) {
	// Shared-seed fork. Independent populateYDoc histories lose one side
	// on sync; createTwoPeerHarness is the path that actually collaborates.
	const harness = createTwoPeerHarness({
		blocks: generateBlockSpecs(blockCount),
	});
	return {
		editorA: harness.peerA.editor,
		editorB: harness.peerB.editor,
		sync() {
			harness.sync();
		},
	};
}

const PEER_A_OBSERVE_TOKEN = "PEER-A-OBSERVED";

/**
 * The SCALE1 peer row is only a measurement after B has seen A's insert.
 * A prior published number timed two documents that never collaborated.
 */
export function assertPeerBObservesPeerAInsert(
	collab: ReturnType<typeof createEnvelopeCollaboration>,
): void {
	const blockId = envelopeBlockId(0);
	const beforeB = collab.editorB.getBlock(blockId).textContent();
	if (beforeB.includes(PEER_A_OBSERVE_TOKEN)) {
		throw new Error(
			"observation token already present on peer B before A wrote",
		);
	}

	collab.editorA.apply(
		[
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: PEER_A_OBSERVE_TOKEN,
			},
		],
		{ origin: "user" },
	);

	const midB = collab.editorB.getBlock(blockId).textContent();
	if (midB.includes(PEER_A_OBSERVE_TOKEN)) {
		throw new Error(
			"peer B observed A's insert before sync; the fixture is not measuring collaboration",
		);
	}

	collab.sync();

	assertPeerBObservedText(collab, blockId, PEER_A_OBSERVE_TOKEN);
}

/**
 * Post-sync observation of a named insert. The SCALE1 timed path uses
 * this after the clock so a no-op sync cannot publish.
 */
export function assertPeerBObservedText(
	collab: ReturnType<typeof createEnvelopeCollaboration>,
	blockId: string,
	token: string,
): void {
	const afterB = collab.editorB.getBlock(blockId).textContent();
	if (!afterB.includes(token)) {
		throw new Error(
			`peer B did not observe peer A's insert after sync: ${JSON.stringify(afterB)}`,
		);
	}
}

export function measureNestingDepth(
	editor: TestEditor,
	rootId: string,
): number {
	let depth = 0;
	let current: BlockHandle | null = editor.getBlock(rootId);
	while (current) {
		depth += 1;
		current = current.children[0] ?? null;
	}
	return depth;
}

export function createNestingEditor(depth: number): TestEditor {
	const editor = createTestEditor({ blocks: [] });
	const ops: DocumentOp[] = [];
	for (let level = 0; level < depth; level++) {
		const blockId = envelopeNestId(level);
		if (level === 0) {
			ops.push({
				type: "insert-block",
				blockId,
				blockType: "callout",
				props: { severity: "info" },
				position: "last",
			});
			continue;
		}
		const parentId = envelopeNestId(level - 1);
		ops.push({
			type: "insert-block",
			blockId,
			blockType: "callout",
			props: { severity: "info", parentId },
			position: { parent: parentId, index: 0 },
		});
	}
	editor.apply(ops, { origin: "user" });
	dropForeignTopLevelBlocks(editor, envelopeNestId(0));
	return editor;
}

export function createTableEditor(rows: number, cols: number): TestEditor {
	const editor = createTestEditor({ blocks: [] });
	const ops: DocumentOp[] = [
		{
			type: "insert-block",
			blockId: ENVELOPE_TABLE_BLOCK_ID,
			blockType: "table",
			props: { hasHeaderRow: true },
			position: "last",
		},
	];
	for (let col = 2; col < cols; col++) {
		ops.push({
			type: "grid", blockId: ENVELOPE_TABLE_BLOCK_ID, change: { kind: "insert-column", index: col },
		});
	}
	for (let row = 2; row < rows; row++) {
		ops.push({
			type: "grid", blockId: ENVELOPE_TABLE_BLOCK_ID, change: { kind: "insert-row", index: row },
		});
	}
	editor.apply(ops, { origin: "user" });
	dropForeignTopLevelBlocks(editor, ENVELOPE_TABLE_BLOCK_ID);
	return editor;
}

/**
 * Live fixture dimension for a SCALE1 rung. Block-count rungs use the
 * generator length (cheap). Nesting, table, and peers build a document.
 */
export function measurePublishedCount(rungId: EnvelopeRungId): number {
	switch (rungId) {
		case "blocks-100":
			return generateBlockSpecs(100).length;
		case "blocks-1000":
			return generateBlockSpecs(1000).length;
		case "blocks-5000":
			return generateBlockSpecs(5000).length;
		case "long-block":
			return longBlockCharCount();
		case "nesting-10":
			return measureCreatedNestingDepth(SCALE1_NESTING_DEPTH);
		case "table-50x20":
			return measureCreatedTableCells(
				SCALE1_TABLE_ROWS,
				SCALE1_TABLE_COLS,
			);
		case "concurrentPeers-2":
			return measureSharedSeedPeerCount();
		default:
			return assertNeverEnvelopeRung(rungId);
	}
}

export function measureCreatedNestingDepth(depth: number): number {
	const editor = createNestingEditor(depth);
	const measured = measureNestingDepth(editor, envelopeNestId(0));
	void editor.destroy();
	return measured;
}

export function measureCreatedTableCells(rows: number, cols: number): number {
	const editor = createTableEditor(rows, cols);
	const table = editor.getBlock(ENVELOPE_TABLE_BLOCK_ID).as("table");
	const measured =
		(table?.tableRowCount() ?? 0) * (table?.tableColumnCount() ?? 0);
	void editor.destroy();
	return measured;
}

/**
 * SCALE1 concurrent peers (W5.R7): forks `peerCount` peers from one seed,
 * has each insert its own token into `block-0`, runs `sync`, and returns how
 * many peers hold every token. The constant is the input, never the result:
 * a dropped delivery lowers the count and fails drift by name.
 */
export function measureSharedSeedPeerCount(
	peerCount: number = SCALE1_PEER_COUNT,
	sync: (harness: PeerHarness) => void = (harness) => harness.syncAll(),
): number {
	const harness = createPeerHarness(peerCount, {
		blocks: generateBlockSpecs(4),
	});
	try {
		const blockId = envelopeBlockId(0);
		const tokens = harness.peers.map((peer) => `TOKEN-${peer.label.toUpperCase()}-SURVIVE`);
		for (const [index, peer] of harness.peers.entries()) {
			peer.editor.apply(
				[
					{
						type: "splice-text",
						blockId,
						from: 0,
						to: 0,
						insert: tokens[index]!,
					},
				],
				{ origin: "user" },
			);
		}
		sync(harness);
		return harness.peers.filter((peer) => {
			const text = peer.editor.getBlock(blockId)?.textContent() ?? "";
			return tokens.every((token) => text.includes(token));
		}).length;
	} finally {
		harness.destroy();
	}
}

/**
 * Both peers write, then sync, then count tokens present on both
 * documents. Shared-seed survival is 2. Independent populate is the
 * historical defect: LWW keeps one Y.Text and drops the other edit,
 * so this returns 0 or 1 — never 2.
 */
export function measurePeerTokenSurvival(
	collab: ReturnType<typeof createEnvelopeCollaboration>,
): number {
	const blockId = envelopeBlockId(0);
	const tokenA = "TOKEN-A-SURVIVE";
	const tokenB = "TOKEN-B-SURVIVE";
	collab.editorA.apply(
		[{ type: "splice-text", blockId, from: 0,
				to: 0,
				insert: tokenA }],
		{ origin: "user" },
	);
	collab.editorB.apply(
		[{ type: "splice-text", blockId, from: 0,
				to: 0,
				insert: tokenB }],
		{ origin: "user" },
	);
	collab.sync();
	const textA = collab.editorA.getBlock(blockId).textContent();
	const textB = collab.editorB.getBlock(blockId).textContent();
	return [tokenA, tokenB].filter(
		(token) => textA.includes(token) && textB.includes(token),
	).length;
}

/** The independently-populated fixture that published a fake peer number. */
export function measureIndependentPeerSurvival(): number {
	const editorA = createTestEditor({ blocks: generateBlockSpecs(4) });
	const editorB = createTestEditor({ blocks: generateBlockSpecs(4) });
	const collab = {
		editorA,
		editorB,
		sync() {
			const fromA = editorA.crdtDoc.adapter.encodeUpdate(
				editorA.crdtDoc,
				Y.encodeStateVector(editorB.ydoc),
			);
			const fromB = editorB.crdtDoc.adapter.encodeUpdate(
				editorB.crdtDoc,
				Y.encodeStateVector(editorA.ydoc),
			);
			if (fromA.byteLength > 0) {
				editorB.crdtDoc.adapter.applyUpdate(editorB.crdtDoc, fromA);
			}
			if (fromB.byteLength > 0) {
				editorA.crdtDoc.adapter.applyUpdate(editorA.crdtDoc, fromB);
			}
		},
	};
	try {
		return measurePeerTokenSurvival(collab);
	} finally {
		void editorA.destroy();
		void editorB.destroy();
	}
}

function longBlockCharCount(chars: number = SCALE1_LONG_BLOCK_CHARS): number {
	const spec = generateLongBlockSpec(chars)[0];
	if (!spec?.content) {
		throw new Error("long-block fixture has no content");
	}
	return spec.content.length;
}

export interface EnvelopeKeystroke {
	ops: DocumentOp[];
	targetId: string;
}

export function envelopeKeystroke(rungId: EnvelopeRungId): EnvelopeKeystroke {
	switch (rungId) {
		case "blocks-100":
			return blockCountKeystroke(100);
		case "blocks-1000":
			return blockCountKeystroke(1000);
		case "blocks-5000":
			return blockCountKeystroke(5000);
		case "long-block":
			return {
				ops: [
					{
						type: "splice-text",
						blockId: ENVELOPE_LONG_BLOCK_ID,
						from: SCALE1_LONG_BLOCK_CHARS,
				to: SCALE1_LONG_BLOCK_CHARS,
				insert: "x",
					},
				],
				targetId: ENVELOPE_LONG_BLOCK_ID,
			};
		case "nesting-10": {
			const blockId = envelopeNestId(SCALE1_NESTING_DEPTH - 1);
			return {
				ops: [
					{
						type: "splice-text",
						blockId,
						from: 0,
				to: 0,
				insert: "x",
					},
				],
				targetId: blockId,
			};
		}
		case "table-50x20":
			return {
				ops: [
					{
						type: "splice-text",
						blockId: ENVELOPE_TABLE_BLOCK_ID,
						cell: {
							row: SCALE1_TABLE_ROWS - 1,
							col: SCALE1_TABLE_COLS - 1,
						},
						from: 0,
						to: 0,
						insert: "x",
					},
				],
				targetId: ENVELOPE_TABLE_BLOCK_ID,
			};
		case "concurrentPeers-2":
			return blockCountKeystroke(100);
		default:
			return assertNeverEnvelopeRung(rungId);
	}
}

function blockCountKeystroke(count: number): EnvelopeKeystroke {
	const blockId = envelopeBlockId(Math.floor(count / 2));
	return {
		ops: [
			{
				type: "splice-text",
				blockId,
				from: 0,
				to: 0,
				insert: "x",
			},
		],
		targetId: blockId,
	};
}

function seedUpdate(rungId: EnvelopeRungId): Uint8Array {
	const cached = seedUpdates.get(rungId);
	if (cached) {
		return cached;
	}

	const ydoc = buildRungYDoc(rungId);
	const update = Y.encodeStateAsUpdate(ydoc);
	seedUpdates.set(rungId, update);
	return update;
}

function buildRungYDoc(rungId: EnvelopeRungId): Y.Doc {
	switch (rungId) {
		case "blocks-100":
			return createTestDocument(generateBlockSpecs(100)).ydoc;
		case "blocks-1000":
			return createTestDocument(generateBlockSpecs(1000)).ydoc;
		case "blocks-5000":
			return createTestDocument(generateBlockSpecs(5000)).ydoc;
		case "long-block":
			return createTestDocument(generateLongBlockSpec()).ydoc;
		case "nesting-10":
			return buildNestingYDoc();
		case "table-50x20":
			return buildTableYDoc();
		case "concurrentPeers-2":
			return createTestDocument(generateBlockSpecs(100)).ydoc;
		default:
			return assertNeverEnvelopeRung(rungId);
	}
}

function buildNestingYDoc(): Y.Doc {
	const editor = createNestingEditor(SCALE1_NESTING_DEPTH);
	const ydoc = snapshotYDoc(editor.ydoc);
	void editor.destroy();
	return ydoc;
}

function buildTableYDoc(): Y.Doc {
	const editor = createTableEditor(SCALE1_TABLE_ROWS, SCALE1_TABLE_COLS);
	const ydoc = snapshotYDoc(editor.ydoc);
	void editor.destroy();
	return ydoc;
}

function dropForeignTopLevelBlocks(
	editor: TestEditor,
	keepId: string,
): void {
	const extras: DocumentOp[] = [];
	for (let index = 0; index < editor.document.blockOrder.length; index++) {
		const blockId = editor.document.blockOrder.get(index);
		if (typeof blockId === "string" && blockId !== keepId) {
			extras.push({ type: "delete-block", blockId });
		}
	}
	if (extras.length > 0) {
		editor.apply(extras, { origin: "user" });
	}
}

function snapshotYDoc(source: Y.Doc): Y.Doc {
	const ydoc = new Y.Doc();
	Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(source));
	return ydoc;
}

function blockTypeForIndex(index: number): string {
	if (index % 10 === 0) {
		return "heading";
	}
	if (index % 5 === 0) {
		return "codeBlock";
	}
	return "paragraph";
}
