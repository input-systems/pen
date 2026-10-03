import { createHash } from "node:crypto";
import type { Editor } from "@input/pen-types";

/**
 * A digest of the whole CRDT state. Equal before and after means nothing was
 * written — not even a change that a later write undid.
 */
export function documentHash(editor: Editor): string {
	const crdt = editor.internals.crdtDoc;
	return createHash("sha256")
		.update(Buffer.from(crdt.adapter.encodeState(crdt)))
		.digest("hex");
}
