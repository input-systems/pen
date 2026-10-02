import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { CRDTDiagnostic } from "../adapter";
import { yjsAdapter } from "../adapter";
import { createYjsAwareness } from "../awareness";
import { YJS_SINGLETON_MISMATCH_CODE } from "../yjsSingleton";
import { loadDuplicateYjs } from "./fixtures/yjs-duplicate/load";

describe("API2 awareness and duplicate copies", () => {
	it("API2: yjsAdapter() creates no awareness; the awareness option opts in", () => {
		const plain = yjsAdapter();
		expect(plain.createAwareness).toBeUndefined();

		const wired = yjsAdapter({ awareness: createYjsAwareness });
		const awareness = wired.createAwareness?.(wired.createDocument());
		expect(awareness).toBeTruthy();
		awareness?.destroy();
	});

	it("API2: a provider applying updates with a second yjs copy is reported once per document", async () => {
		const { module: DuplicateY } = await loadDuplicateYjs();
		expect(DuplicateY.Doc).not.toBe(Y.Doc);

		const diagnostics: CRDTDiagnostic[] = [];
		const adapter = yjsAdapter({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const doc = adapter.createDocument();
		const unobserve = adapter.observe(doc, () => {});

		const peer = new DuplicateY.Doc();
		peer.getMap("metadata").set("k", "v");
		const update = DuplicateY.encodeStateAsUpdate(peer);
		const ydoc = (doc as unknown as { ydoc: Y.Doc }).ydoc;
		DuplicateY.applyUpdate(ydoc as never, update);
		DuplicateY.applyUpdate(ydoc as never, update);

		const mismatches = diagnostics.filter(
			(diagnostic) => diagnostic.code === YJS_SINGLETON_MISMATCH_CODE,
		);
		expect(mismatches).toHaveLength(1);
		expect(mismatches[0]?.severity).toBe("error");
		unobserve();
	});

	it("API2: transactions from the adapter's own yjs copy are not reported", () => {
		const diagnostics: CRDTDiagnostic[] = [];
		const adapter = yjsAdapter({
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		const doc = adapter.createDocument();
		const unobserve = adapter.observe(doc, () => {});
		const peer = new Y.Doc();
		peer.getMap("metadata").set("k", "v");
		adapter.applyUpdate(doc, Y.encodeStateAsUpdate(peer));

		expect(
			diagnostics.filter((d) => d.code === YJS_SINGLETON_MISMATCH_CODE),
		).toHaveLength(0);
		unobserve();
	});
});
