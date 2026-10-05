// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { findLogicalDOMPoint } from "../inlineAtomLogicalDom";
import { mountBlockDom } from "./fieldEditorFixtures.testHelpers";

describe("writeNativeRange point resolution", () => {
	it("resolves offset 0 to a text node, not the inline element", () => {
		const { root, inline } = mountBlockDom(
			"block-1",
			"Alpha bravo charlie delta echo",
		);
		try {
			const start = findLogicalDOMPoint(inline, 0);
			expect(start.node.nodeType).toBe(Node.TEXT_NODE);
			expect(start.offset).toBe(0);
			expect(root.contains(start.node)).toBe(true);
		} finally {
			root.remove();
		}
	});
});
