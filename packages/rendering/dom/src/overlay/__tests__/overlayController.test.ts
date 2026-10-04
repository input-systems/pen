// @vitest-environment jsdom

import type { DiagnosticEvent } from "@input/pen-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import {
	createOverlayFixture,
	flushFrame,
	focusCaretContributor,
	installMockRaf,
	type OverlayFixture,
} from "./overlayFixture";

describe("overlay controller (W35.R1, W35.R11)", () => {
	let fixture: OverlayFixture;

	beforeEach(() => {
		installMockRaf();
		fixture = createOverlayFixture();
	});

	afterEach(() => {
		fixture.destroy();
		vi.unstubAllGlobals();
	});

	it("OV1: contributor requests resolve to layer-relative items in the read phase", () => {
		const { controller, editor, blockId } = fixture;
		const phases: string[] = [];
		controller.registerContributor({
			id: "outline",
			requests: () => {
				phases.push(fixture.scheduler.phase);
				return [{ kind: "block-outline", key: "o", blockId }];
			},
		});
		controller.registerContributor(focusCaretContributor());
		editor.selectText(blockId, 3, 3, { origin: "keyboard" });
		flushFrame();

		expect(phases).toEqual(["read"]);
		const plan = controller.plan;
		expect(plan?.items.map((item) => [item.kind, item.x, item.width])).toEqual([
			["block-outline", 0, 100],
			["caret", 30, 0],
		]);
		expect(plan?.nativeCaretHidden).toBe(true);
		expect(plan?.selectionVersion).toBeGreaterThan(0);
		expect(
			controller.layer.getAttribute("data-pen-overlay-selection-version"),
		).toBe(String(plan?.selectionVersion));
		expect(controller.layer.hasAttribute("data-caret-visible")).toBe(true);
	});

	it("OV1: a request for an unmounted block is reported unresolved and never painted", () => {
		const { controller } = fixture;
		controller.registerContributor({
			id: "remote",
			requests: () => [
				{
					kind: "caret",
					key: "remote:1",
					role: "remote",
					point: { blockId: "offscreen", offset: 0 },
					affinity: "downstream",
				},
				{ kind: "block-outline", key: "o", blockId: "offscreen" },
				{
					kind: "block-span",
					key: "s",
					fromBlockId: fixture.blockId,
					toBlockId: "offscreen",
				},
				{
					kind: "cell-range",
					key: "c",
					blockId: "table",
					anchor: { row: 0, col: 0 },
					head: { row: 1, col: 1 },
				},
			],
		});
		expect(() => flushFrame()).not.toThrow();
		expect(controller.plan?.items).toEqual([]);
		expect(controller.plan?.unresolved).toEqual([
			{ key: "remote:1", contributor: "remote", blockId: "offscreen" },
			{ key: "o", contributor: "remote", blockId: "offscreen" },
			{ key: "s", contributor: "remote", blockId: "offscreen" },
			{ key: "c", contributor: "remote", blockId: "table" },
		]);
		expect(controller.layer.childElementCount).toBe(0);
	});

	it("OV1: a contributor that throws is dropped with a diagnostic, and the others still paint", () => {
		const { controller, editor, blockId } = fixture;
		const diagnostics: DiagnosticEvent[] = [];
		const unsubscribe = editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		controller.registerContributor({
			id: "broken",
			requests: () => {
				throw new Error("boom");
			},
		});
		controller.registerContributor({
			id: "outline",
			requests: () => [{ kind: "block-outline", key: "o", blockId }],
		});
		flushFrame();
		unsubscribe();

		expect(controller.plan?.items).toHaveLength(1);
		expect(diagnostics.map((event) => event.code)).toContain(
			"overlay-contributor-failed",
		);
	});

	it("O: the native caret is hidden only while a local caret is painted, and its inline value comes back", () => {
		const { controller, editor, blockId, root } = fixture;
		const surface = document.createElement("div");
		surface.setAttribute(DATA_ATTRS.fieldEditorActiveSurface, "");
		surface.style.caretColor = "red";
		root.prepend(surface);
		let enabled = true;
		const caret = focusCaretContributor();
		controller.registerContributor({
			id: "toggle",
			requests: (context) => (enabled ? caret.requests(context) : []),
		});
		editor.selectText(blockId, 1, 1, { origin: "keyboard" });
		flushFrame();
		expect(surface.style.caretColor).toBe("transparent");

		enabled = false;
		controller.requestPaint();
		flushFrame();
		expect(surface.style.caretColor).toBe("red");
		expect(controller.layer.hasAttribute("data-caret-visible")).toBe(false);
	});

	it("O: holdCaretMode and holdCaretPaint are refcounted and reach the contributor and plan", () => {
		const { controller, editor, blockId } = fixture;
		const modes: string[] = [];
		const caret = focusCaretContributor();
		controller.registerContributor({
			id: "mode",
			requests: (context) => {
				modes.push(context.caretMode);
				return caret.requests(context);
			},
		});
		editor.selectText(blockId, 1, 1, { origin: "keyboard" });
		flushFrame();
		const releaseA = controller.holdCaretMode("all");
		const releaseB = controller.holdCaretMode("all");
		const releasePaint = controller.holdCaretPaint("binding");
		flushFrame();
		expect(controller.plan?.items[0]?.paint).toBe("binding");
		expect(controller.layer.childElementCount).toBe(0);
		releaseA();
		releaseA();
		flushFrame();
		releaseB();
		releasePaint();
		flushFrame();
		expect(modes).toEqual(["auto", "all", "all", "auto"]);
		expect(controller.plan?.items[0]?.paint).toBe("layer");
		expect(controller.layer.childElementCount).toBe(1);
	});

	it("O5: field state reaches the read context, including the renderer read-only flag", () => {
		const { controller } = fixture;
		const readonly: boolean[] = [];
		controller.registerContributor({
			id: "field",
			requests: ({ field }) => {
				readonly.push(field.readonly);
				return [];
			},
		});
		flushFrame();
		fixture.setField({ readonly: true });
		flushFrame();
		expect(readonly).toEqual([false, true]);
	});

	it("S2: the D5 substitute reaches the read context from the field's getSubstituteState and repaints when it changes", () => {
		const { controller } = fixture;
		const substitutes: unknown[] = [];
		controller.registerContributor({
			id: "field",
			requests: ({ field }) => {
				substitutes.push(field.substitute);
				return [];
			},
		});
		flushFrame();
		fixture.setField({ substitute: "engine-confined-range" });
		flushFrame();
		fixture.setField({ substitute: null });
		flushFrame();
		expect(substitutes).toEqual([null, "engine-confined-range", null]);
	});

	it("OV2: dispose removes the layer and restores nothing it did not change", () => {
		const { controller, root } = fixture;
		expect(root.lastElementChild).toBe(controller.layer);
		controller.dispose();
		expect(controller.layer.isConnected).toBe(false);
	});
});
