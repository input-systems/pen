import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import * as YDuplicate from "yjs-duplicate";

import { yjsAdapter } from "../adapter";
import { wrapYjsDocument } from "../document";

describe("API2", () => {
	it("does not get a second Y.Doc constructor from an npm:yjs alias", () => {
		// pnpm links yjs-duplicate (npm:yjs at the same version as yjs) to the
		// same store path as yjs. Node and Vitest then evaluate one module, so
		// this is not the duplicated copy the spec asked for. Keep the identity
		// assertion so a future install that actually forks the module fails
		// here instead of silently passing.
		expect(Y.Doc).toBe(YDuplicate.Doc);

		const adapter = yjsAdapter();
		const duplicateDoc = new YDuplicate.Doc();
		expect(duplicateDoc instanceof Y.Doc).toBe(true);
		expect(wrapYjsDocument(adapter, duplicateDoc).ydoc).toBe(duplicateDoc);
	});
});
