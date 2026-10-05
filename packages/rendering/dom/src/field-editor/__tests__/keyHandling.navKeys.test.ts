import { getEditorSelectionRecord } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import { afterEach, describe, expect, it } from "vitest";
import { handleFieldEditorKeyDown } from "../keyHandling";
import {
	getYText,
	keyEvent,
	recordingController,
	seedParagraphs,
	spyDispatch,
	withPlatform,
} from "./fieldEditorFixtures.testHelpers";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

/** One paragraph holding `text`, the caret at `caret`, and a key presser. */
function field(text: string, caret: number) {
	const {
		editor,
		blockIds: [blockId],
	} = seedParagraphs([text]);
	editors.push(editor);
	editor.selectText(blockId!, caret, caret);
	const { controller } = recordingController(blockId!);
	const press = (event: KeyboardEvent, start: number, end = start) =>
		handleFieldEditorKeyDown({
			event,
			editor,
			fieldEditor: controller,
			ytext: getYText(editor, blockId!),
			range: { start, end },
		});
	return { editor, blockId: blockId!, press };
}

describe("K1 unbound navigation keys", () => {
	it("K1: PageDown preventDefaults and leaves the caret put", () => {
		const { editor, blockId, press } = field("Hello World", 11);
		const event = keyEvent("PageDown");

		expect(press(event, 11)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId, offset: 11 },
		});
	});

	it("K1: PageDown during composition is not intercept", () => {
		const { press } = field("", 0);
		const event = keyEvent("PageDown", { isComposing: true });

		expect(press(event, 0)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
	});
});

describe("M3 Home dispatch", () => {
	it("M3: Home dispatches pen.caretLineStart and moves the authority", () => {
		const { editor, blockId, press } = field("Hello World", 5);
		const dispatched = spyDispatch(editor);
		const event = keyEvent("Home");

		expect(withPlatform("Linux x86_64", () => press(event, 5))).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(dispatched).toContain("pen.caretLineStart");
		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId, offset: 0 },
		});
	});
});

describe("word selection extension", () => {
	it("preserves a backward anchor across repeated Alt+Shift+ArrowLeft", () => {
		const { editor, blockId, press } = field("one two three", 13);
		const wordLeft = () => keyEvent("ArrowLeft", { altKey: true, shiftKey: true });

		withPlatform("MacIntel", () => {
			expect(press(wordLeft(), 13)).toBe(true);
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 13 },
				focus: { blockId, offset: 8 },
			});

			expect(press(wordLeft(), 8, 13)).toBe(true);
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 13 },
				focus: { blockId, offset: 4 },
			});
		});
	});
});

describe("N1 arrow keys beside inline atoms", () => {
	/** "a", atom at 1..2, "b". */
	function atomField(caret: number, direction?: "rtl") {
		const fixture = field("ab", caret);
		const { editor, blockId } = fixture;
		editor.apply([
			...(direction ? [{ type: "set-props" as const, blockId, props: { direction } }] : []),
			{
				type: "splice-text",
				blockId,
				from: 1,
				to: 1,
				insert: { nodeType: "mention", props: { id: "user-ada", label: "Ada" } },
			},
		]);
		editor.selectText(blockId, caret, caret);
		return fixture;
	}

	it("N1: field-editor keydown leaves arrow keys beside atoms to the keymap", () => {
		const { editor, blockId, press } = atomField(2);

		expect(press(keyEvent("ArrowLeft"), 2)).toBe(true);
		const record = getEditorSelectionRecord(editor);
		expect(record?.state).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 2 },
		});
		expect(record?.origin).toBe("keyboard");
	});

	it("M2 N1: in an rtl block ArrowLeft beside an atom steps forward over it", () => {
		const { editor, blockId, press } = atomField(1, "rtl");

		press(keyEvent("ArrowLeft"), 1);

		expect(getEditorSelectionRecord(editor)?.state).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 2 },
		});
	});
});
