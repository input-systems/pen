import { describe, expect, it } from "vitest";
import type { Editor } from "@input/pen-types";
import {
	serializeDeltasToFormat,
	writePenClipboard,
} from "../utils/clipboardSerialization";
import { createClipboardEvent } from "./clipboardSerialization.testHelpers";

function stubEditor(): Editor {
	return {
		schema: {
			resolveInline() {
				return undefined;
			},
		},
	} as unknown as Editor;
}

describe("EM8 clipboard serialization", () => {
	it("EM1: writePenClipboard emits empty text/plain for an empty block", () => {
		const { event, get } = createClipboardEvent();
		writePenClipboard([], "", "", event);

		expect(get("text/plain")).toBe("");
	});

	it("writePenClipboard leaves user text unchanged", () => {
		const { event, get } = createClipboardEvent();
		writePenClipboard([], "", "Hello world", event);

		expect(get("text/plain")).toBe("Hello world");
	});

	it("EM1: serializeDeltasToFormat omits an empty-block delta", () => {
		const html = serializeDeltasToFormat(
			[{ insert: "" }],
			stubEditor(),
			"html",
		);

		expect(html).toBe("");
	});
});
