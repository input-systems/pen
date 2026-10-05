import { initBlockMap, validateDocument } from "@input/pen-yjs";
import * as Y from "yjs";
import type { FieldEditorDelta } from "../crdt";
import { rebaseTextDiffOps } from "../contenteditableDomHelpers";
import { computeAnchoredTextDiff } from "../textDiff";

/**
 * C2 rebase harness: one paragraph block in a Pen-shaped `Y.Doc`. The oracle
 * is two docs applying the composition and the remote splices concurrently;
 * client ids put the remote edit first (Yjs orders a lower id first), which
 * is the D3 tie-break.
 */

export const BLOCK_ID = "c2-block";
const REMOTE_CLIENT_ID = 1;
const LOCAL_CLIENT_ID = 2;
const SUBJECT_CLIENT_ID = 3;

export type Splice = { readonly at: number; readonly deleteLength: number; readonly insert: string };

export type Composition = Splice & {
	/** The authority selection's start at compositionstart. */
	readonly startOffset: number;
};

function seedDocument(base: string): Uint8Array {
	const ydoc = new Y.Doc({ gc: false });
	const blocks = ydoc.getMap<Y.Map<unknown>>("blocks");
	ydoc.transact(() => {
		ydoc.getMap("apps");
		ydoc.getMap("metadata");
		const block = initBlockMap(blocks, BLOCK_ID, "paragraph", "inline");
		(block.get("content") as Y.Text).insert(0, base);
		ydoc.getArray<string>("blockOrder").push([BLOCK_ID]);
	});
	const update = Y.encodeStateAsUpdate(ydoc);
	ydoc.destroy();
	return update;
}

function fork(seed: Uint8Array, clientId: number): Y.Doc {
	const ydoc = new Y.Doc({ gc: false });
	ydoc.clientID = clientId;
	Y.applyUpdate(ydoc, seed);
	// Root types exist only once named; validateDocument checks their kind.
	ydoc.getArray("blockOrder");
	ydoc.getMap("blocks");
	ydoc.getMap("apps");
	ydoc.getMap("metadata");
	return ydoc;
}

export function contentOf(ydoc: Y.Doc): Y.Text {
	return ydoc.getMap<Y.Map<unknown>>("blocks").get(BLOCK_ID)!.get("content") as Y.Text;
}

function applySplice(text: Y.Text, splice: Splice): void {
	if (splice.deleteLength > 0) text.delete(splice.at, splice.deleteLength);
	if (splice.insert.length > 0) text.insert(splice.at, splice.insert);
}

export function composeText(base: string, composition: Splice): string {
	return (
		base.slice(0, composition.at) +
		composition.insert +
		base.slice(composition.at + composition.deleteLength)
	);
}

export type C2Outcome = {
	readonly rebased: string;
	readonly oracle: string;
	readonly validationErrors: readonly string[];
};

/** Runs the rebase under test and the two-doc oracle on the same inputs. */
export function runC2Case(
	base: string,
	composition: Composition,
	remoteSplices: readonly Splice[],
): C2Outcome {
	const seed = seedDocument(base);

	const remote = fork(seed, REMOTE_CLIENT_ID);
	const remoteUpdates: Uint8Array[] = [];
	const record = (update: Uint8Array) => remoteUpdates.push(update);
	remote.on("update", record);
	for (const splice of remoteSplices) {
		remote.transact(() => applySplice(contentOf(remote), splice));
	}
	remote.off("update", record);

	const local = fork(seed, LOCAL_CLIENT_ID);
	local.transact(() => applySplice(contentOf(local), composition));
	Y.applyUpdate(local, Y.encodeStateAsUpdate(remote));
	Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));

	const subject = fork(seed, SUBJECT_CLIENT_ID);
	const deferred: Array<{ delta: FieldEditorDelta[] }> = [];
	const subjectText = contentOf(subject);
	const collect = (event: Y.YTextEvent) => {
		deferred.push({ delta: event.delta as FieldEditorDelta[] });
	};
	subjectText.observe(collect);
	for (const update of remoteUpdates) Y.applyUpdate(subject, update);
	subjectText.unobserve(collect);

	const diff = computeAnchoredTextDiff(base, composeText(base, composition), composition.startOffset);
	const rebased = rebaseTextDiffOps(diff, deferred, base.length);
	subject.transact(() => {
		for (const op of rebased) {
			if (op.type === "insert") subjectText.insert(op.offset, op.text);
			else subjectText.delete(op.offset, op.length);
		}
	});

	const validationErrors = [local, remote, subject].flatMap((ydoc) =>
		validateDocument(ydoc).errors.map((error) => `${error.code}: ${error.message}`),
	);
	const outcome = {
		rebased: subjectText.toString(),
		oracle: contentOf(local).toString(),
		validationErrors,
	};
	for (const ydoc of [local, remote, subject]) ydoc.destroy();
	return outcome;
}
