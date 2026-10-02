import { createYjsAwareness } from "@input/pen-yjs/awareness";
import type { YjsCRDTDocument } from "@input/pen-yjs";
import { describe, expect, it } from "vitest";

import { createEditor } from "../editor/editor";

describe("DocumentSession.ensureAwareness (API2)", () => {
	it("API2: the default adapter creates no awareness and ensureAwareness creates it once per scope", () => {
		const editor = createEditor({});
		const { documentSession, documentScope } = editor.internals;
		expect(editor.internals.awareness).toBeNull();

		let created = 0;
		const factory = (doc: Parameters<typeof createYjsAwareness>[0]) => {
			created += 1;
			return createYjsAwareness(doc);
		};
		const first = documentSession!.ensureAwareness!(documentScope.id, (doc) =>
			factory(doc as YjsCRDTDocument),
		);
		const second = documentSession!.ensureAwareness!(documentScope.id, (doc) =>
			factory(doc as YjsCRDTDocument),
		);

		expect(second).toBe(first);
		expect(created).toBe(1);
		expect(editor.internals.awareness).toBe(first);
		editor.destroy();
	});
});
