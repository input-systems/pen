import type { BlockHandle } from "@input/pen-types";
import { describe, expect, it } from "vitest";
import { getNumberedListItemValue } from "../editor/orderedList";

describe("getNumberedListItemValue", () => {
	it("derives numbered list values from prior siblings at the same indent", () => {
		const firstItem = createNumberedListBlock("b1", null, { start: 3 });
		const secondItem = createNumberedListBlock("b2", firstItem);
		const nestedItem = createNumberedListBlock("b3", secondItem, {
			indent: 1,
		});
		const thirdItem = createNumberedListBlock("b4", nestedItem);

		expect(getNumberedListItemValue(firstItem)).toBe(3);
		expect(getNumberedListItemValue(secondItem)).toBe(4);
		expect(getNumberedListItemValue(nestedItem)).toBe(1);
		expect(getNumberedListItemValue(thirdItem)).toBe(5);
	});

	it("counts over the item's sibling list, not the root order (AX1)", () => {
		// Root order: n1, bq, c1 and c2 (bq's `parentId` children), n2.
		const n1 = createNumberedListBlock("n1", null);
		const bq = createBlock("bq", "blockquote", n1);
		const c1 = createNumberedListBlock("c1", bq, { parentId: "bq" });
		const c2 = createNumberedListBlock("c2", c1, { parentId: "bq" });
		const n2 = createNumberedListBlock("n2", c2);

		expect(getNumberedListItemValue(c1)).toBe(1);
		expect(getNumberedListItemValue(c2)).toBe(2);
		expect(getNumberedListItemValue(n2), "bq ends the root run").toBe(1);
	});

	it("skips an earlier sibling's nested children when counting", () => {
		// Root order: n1, n2, nested (n2's `parentId` child), n3.
		const n1 = createNumberedListBlock("n1", null);
		const n2 = createNumberedListBlock("n2", n1);
		const nested = createBlock("nested", "paragraph", n2, { parentId: "n2" });
		const n3 = createNumberedListBlock("n3", nested);

		expect(getNumberedListItemValue(n3)).toBe(3);
	});

	it("counts a children-array item over its layout parent's children", () => {
		const t1 = createNumberedListBlock("t1", null);
		const t2 = createNumberedListBlock("t2", null);
		const container = createBlock("tg", "toggle", null);
		Object.assign(container, { children: [t1, t2] });
		Object.assign(t1, { parent: container });
		Object.assign(t2, { parent: container });

		expect(getNumberedListItemValue(t1)).toBe(1);
		expect(getNumberedListItemValue(t2)).toBe(2);
	});

	it("returns null for non-numbered blocks", () => {
		expect(
			getNumberedListItemValue({
				id: "p1",
				type: "paragraph",
				props: {},
			} as BlockHandle),
		).toBeNull();
		expect(getNumberedListItemValue(null)).toBeNull();
	});
});

function createNumberedListBlock(
	id: string,
	prev: BlockHandle | null,
	props: Record<string, unknown> = {},
): BlockHandle {
	return createBlock(id, "numberedListItem", prev, props);
}

function createBlock(
	id: string,
	type: string,
	prev: BlockHandle | null,
	props: Record<string, unknown> = {},
): BlockHandle {
	const handle = {
		id,
		type,
		props,
		prev,
		as(capability: string) {
			return capability === "table" && handle.type === "table"
				? handle
				: null;
		},
	};
	return handle as unknown as BlockHandle;
}
