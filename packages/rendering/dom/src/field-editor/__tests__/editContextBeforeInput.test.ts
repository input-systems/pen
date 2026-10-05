// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupMountedFields,
	mountField,
} from "./fieldEditorFixtures.testHelpers";

afterEach(cleanupMountedFields);

function dispatchBeforeInput(
	inline: HTMLElement,
	inputType: string,
): InputEvent {
	const event = new InputEvent("beforeinput", {
		bubbles: true,
		cancelable: true,
		inputType,
	});
	inline.dispatchEvent(event);
	return event;
}

describe("B1 EditContext beforeinput policy", () => {
	// The reported bug: Chromium runs deleteSoftLineBackward as a plain DOM
	// edit instead of routing it to the attached EditContext, so the field
	// looked cleared while the document still held the text — and the next
	// keystroke repainted it.
	it.each([
		["Cmd+Backspace deletes to line start", "Hello world", 11, "deleteSoftLineBackward", ""],
		["Ctrl+K deletes to line end", "alpha beta", 8, "deleteHardLineForward", "alpha be"],
		// A row whose payload lives on the event is prevented, not dispatched blind.
		["a paste row is prevented, not dispatched blind", "Hello", 5, "insertFromPaste", "Hello"],
	])("B1: %s in the document, not just the DOM", (_name, text, caret, inputType, expected) => {
		const { inline, text: docText } = mountField(text, {
			editContext: true,
			caret,
		});

		const event = dispatchBeforeInput(inline, inputType);

		expect(event.defaultPrevented).toBe(true);
		expect(docText()).toBe(expected);
	});

	it("B2: text input stays unprevented so the EditContext textupdate survives", () => {
		const { inline, text } = mountField("Hello", { editContext: true, caret: 5 });

		for (const inputType of [
			"insertText",
			"insertReplacementText",
			"insertCompositionText",
		]) {
			const event = dispatchBeforeInput(inline, inputType);
			expect([inputType, event.defaultPrevented]).toEqual([inputType, false]);
		}

		expect(text()).toBe("Hello");
	});

	it("B1: an unlisted inputType is blocked and reported instead of editing the DOM", () => {
		const { editor, inline, text } = mountField("Hello", {
			editContext: true,
			caret: 5,
		});
		const codes: string[] = [];
		editor.on("diagnostic", (event: { code: string }) => {
			codes.push(event.code);
		});

		const event = dispatchBeforeInput(inline, "insertHorizontalRule");

		expect(event.defaultPrevented).toBe(true);
		expect(codes).toEqual(["unhandled-input-type"]);
		expect(text()).toBe("Hello");
	});
});
