// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupMountedFields,
	mountField,
} from "./fieldEditorFixtures.testHelpers";

afterEach(cleanupMountedFields);

describe("R1 drag window close inputs", () => {
	it("R1: a cancelled dragstart closes the drag window in the same handler", () => {
		const { fieldEditor, inline } = mountField("Hello");
		const event = new Event("dragstart", { bubbles: true, cancelable: true });
		inline.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(fieldEditor.reader.windows.drag).toBe(false);
	});

	it("R1 R2: a document dragend closes a drag window opened by the field", () => {
		const { fieldEditor } = mountField("Hello");
		fieldEditor.reader.notifyGesture("dragstart");
		expect(fieldEditor.reader.windows.drag).toBe(true);

		document.dispatchEvent(new Event("dragend"));
		expect(fieldEditor.reader.windows.drag).toBe(false);

		fieldEditor.deactivate();
		expect(() => document.dispatchEvent(new Event("dragend"))).not.toThrow();
	});
});
