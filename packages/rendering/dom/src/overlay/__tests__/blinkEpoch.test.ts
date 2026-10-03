// @vitest-environment jsdom

import type { OpOrigin } from "@input/pen-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createOverlayFixture,
	flushFrame,
	focusCaretContributor,
	installMockRaf,
	type OverlayFixture,
} from "./overlayFixture";

describe("overlay blink epoch (W35.R6)", () => {
	let fixture: OverlayFixture;

	beforeEach(() => {
		installMockRaf();
		fixture = createOverlayFixture();
		fixture.controller.registerContributor(focusCaretContributor());
	});

	afterEach(() => {
		fixture.destroy();
		vi.unstubAllGlobals();
	});

	function insert(origin: OpOrigin): void {
		fixture.editor.apply(
			[
				{
					type: "splice-text",
					blockId: fixture.blockId,
					from: 0,
					to: 0,
					insert: "x",
				},
			],
			{ origin },
		);
		flushFrame();
	}

	function select(
		offset: number,
		origin: "pointer" | "keyboard" | "ime" | "programmatic" | "mapped",
	): void {
		fixture.editor.selectText(fixture.blockId, offset, offset, { origin });
		flushFrame();
	}

	function paintedEpoch(): string | null | undefined {
		return fixture.controller.layer
			.querySelector("[data-pen-editor-caret]")
			?.getAttribute("data-pen-caret-epoch");
	}

	it("O: the blink epoch advances once per user commit and once per pointer, keyboard or ime caret move", () => {
		const { controller } = fixture;
		select(2, "programmatic");
		const start = controller.blinkEpoch;
		expect(paintedEpoch()).toBe(String(start));

		insert("user");
		expect(controller.blinkEpoch).toBe(start + 1);
		expect(paintedEpoch()).toBe(String(start + 1));

		insert("collaborator");
		insert("ai");
		insert({ type: "ai", requestId: "r1" });
		select(5, "programmatic");
		select(6, "mapped");
		expect(controller.blinkEpoch).toBe(start + 1);

		select(7, "keyboard");
		expect(controller.blinkEpoch).toBe(start + 2);
		select(7, "keyboard");
		expect(controller.blinkEpoch).toBe(start + 2);

		select(8, "pointer");
		expect(controller.blinkEpoch).toBe(start + 3);
		select(9, "ime");
		expect(controller.blinkEpoch).toBe(start + 4);
		expect(paintedEpoch()).toBe(String(start + 4));
	});

	it("O: two user commits collected by one flush advance the epoch twice", () => {
		const { controller, editor, blockId } = fixture;
		select(1, "programmatic");
		const start = controller.blinkEpoch;
		for (const text of ["a", "b"]) {
			editor.apply(
				[{ type: "splice-text", blockId, from: 0, to: 0, insert: text }],
				{ origin: "user" },
			);
		}
		flushFrame();
		expect(controller.blinkEpoch).toBe(start + 2);
	});

	it("O: a structured user origin restarts the blink like the bare one", () => {
		const { controller } = fixture;
		select(1, "programmatic");
		const start = controller.blinkEpoch;
		insert({ type: "user", groupId: "g1" });
		expect(controller.blinkEpoch).toBe(start + 1);
	});
});
