import { defaultSchema } from "@input/pen-schema";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { FieldEditorTextLike } from "../crdt";
import { resolveFieldInsertMarks } from "../pendingMarkController";

const href = "https://example.com";

// the field editor reads the block's Y.Text through this narrower shape
function fieldText(ytext: Y.Text): FieldEditorTextLike {
	return ytext as unknown as FieldEditorTextLike;
}

function textWith(marks: Record<string, unknown>): Y.Text {
	const ytext = new Y.Doc().getText("content");
	ytext.insert(0, "Hi", marks);
	return ytext;
}

describe("resolveFieldInsertMarks", () => {
	it("returns explicit empty marks after a link so the insert does not inherit it", () => {
		expect(
			resolveFieldInsertMarks(
				undefined,
				defaultSchema,
				fieldText(textWith({ link: { href } })),
				2,
			),
		).toEqual({});
	});

	it("keeps expanding marks and drops the link at the link's end", () => {
		expect(
			resolveFieldInsertMarks(
				undefined,
				defaultSchema,
				fieldText(textWith({ bold: true, link: { href } })),
				2,
			),
		).toEqual({ bold: true });
	});

	it("an insert with the resolved marks after a link is unlinked", () => {
		const ytext = textWith({ link: { href } });
		const marks = resolveFieldInsertMarks(
			undefined,
			defaultSchema,
			fieldText(ytext),
			2,
		);
		ytext.insert(2, "X", marks);

		expect(ytext.toDelta()).toEqual([
			{ insert: "Hi", attributes: { link: { href } } },
			{ insert: "X" },
		]);
	});
});
