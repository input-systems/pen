// @vitest-environment jsdom

import { createEditor, getEditorSelectionRecord } from "@input/pen-core";
import { defaultSchema } from "@input/pen-schema";
import type { DiagnosticEvent } from "@input/pen-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRootGeometry } from "../../geometry/rootGeometry";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { FieldEditorImpl } from "../fieldEditorImpl";
import { focusEditorRoot } from "./focus.testHelpers";

let frameQueue: FrameRequestCallback[] = [];

function installMockRaf(): void {
	frameQueue = [];
	vi.stubGlobal(
		"requestAnimationFrame",
		(callback: FrameRequestCallback): number => {
			frameQueue.push(callback);
			return frameQueue.length;
		},
	);
}

function flushFrame(): void {
	const batch = frameQueue.splice(0);
	for (const callback of batch) {
		callback(0);
	}
}

function mountBlock(
	root: HTMLElement,
	blockId: string,
	text: string,
): HTMLElement {
	const block = document.createElement("div");
	block.setAttribute(DATA_ATTRS.editorBlock, "");
	block.setAttribute(DATA_ATTRS.blockId, blockId);
	const inline = document.createElement("div");
	inline.setAttribute(DATA_ATTRS.inlineContent, "");
	inline.textContent = text;
	block.appendChild(inline);
	root.appendChild(block);
	return block;
}

class ProbeFieldEditor extends FieldEditorImpl {
	get lastProjectedVersion(): number {
		return this.projector.lastProjectedVersion;
	}

	get parkedProjectionVersion(): number | null {
		return this.projector.parkedProjectionVersion;
	}
}

const fixtures: Array<{
	editor: ReturnType<typeof createEditor>;
	fieldEditor: ProbeFieldEditor;
	root: HTMLElement;
}> = [];

afterEach(() => {
	for (const fixture of fixtures.splice(0)) {
		fixture.fieldEditor.destroy();
		fixture.root.remove();
		fixture.editor.destroy();
	}
	vi.unstubAllGlobals();
});

/** A focused root with no mounted blocks; the first block reads `text`. */
function seed(text = "Hi") {
	const editor = createEditor({ schema: defaultSchema });
	const fieldEditor = new ProbeFieldEditor(editor);
	const root = document.createElement("div");
	document.body.appendChild(root);
	fixtures.push({ editor, fieldEditor, root });
	fieldEditor.setRootElement(root);
	focusEditorRoot(root);
	const blockId = editor.firstBlock()!.id;
	if (text) {
		editor.apply([
			{ type: "splice-text", blockId, from: 0, to: 0, insert: text },
		]);
	}
	const unmounted: DiagnosticEvent[] = [];
	editor.on("diagnostic", (event) => {
		if (event.code === "selection-target-unmounted") unmounted.push(event);
	});
	const version = () => getEditorSelectionRecord(editor)!.version;
	return { editor, fieldEditor, root, blockId, unmounted, version };
}

describe("mount ack and parked projections", () => {
	beforeEach(() => {
		installMockRaf();
	});

	it("P4: selection-target-unmounted fires once when the flush after the park ends unacked; a later ack still projects", () => {
		const { editor, fieldEditor, root, blockId, unmounted, version } =
			seed();
		fieldEditor.activate(blockId);
		editor.selectText(blockId, 2, 2);
		expect(fieldEditor.parkedProjectionVersion).toBe(version());
		expect(unmounted).toHaveLength(0);

		flushFrame();
		expect(unmounted).toEqual([
			expect.objectContaining({
				code: "selection-target-unmounted",
				version: version(),
				blockId,
				mountRequested: false,
			}),
		]);

		flushFrame();
		expect(unmounted).toHaveLength(1);

		// The park stays: a later ack still projects.
		fieldEditor.ackBlockMounted(blockId, mountBlock(root, blockId, "Hi"));
		expect(fieldEditor.parkedProjectionVersion).toBeNull();
		expect(fieldEditor.lastProjectedVersion).toBe(version());
	});

	it("P4: a mount requester is asked before the unmounted check and an in-task ack silences it", async () => {
		const { editor, fieldEditor, root, blockId, unmounted, version } =
			seed();
		const requests: Array<{ blockId: string; version: number }> = [];
		fieldEditor.setMountRequester({
			requestMount: (blockId, request) => {
				requests.push({ blockId, version: request.version });
				queueMicrotask(() => {
					fieldEditor.ackBlockMounted(
						blockId,
						mountBlock(root, blockId, "Hi"),
					);
				});
			},
		});
		fieldEditor.activate(blockId);
		editor.selectText(blockId, 2, 2);
		expect(requests).toContainEqual({ blockId, version: version() });

		await Promise.resolve();
		flushFrame();
		expect(fieldEditor.parkedProjectionVersion).toBeNull();
		expect(fieldEditor.lastProjectedVersion).toBe(version());
		expect(unmounted).toHaveLength(0);
	});

	it("discards a parked projection when a newer version parks", () => {
		const { editor, fieldEditor, blockId, version } = seed();
		fieldEditor.activate(blockId);
		editor.selectText(blockId, 0, 0);
		flushFrame();
		const firstParked = fieldEditor.parkedProjectionVersion;
		expect(firstParked).not.toBeNull();

		editor.selectText(blockId, 2, 2);
		flushFrame();
		expect(fieldEditor.parkedProjectionVersion).toBe(version());
		expect(version()).toBeGreaterThan(firstParked!);
	});

	it("P4: an ack for the parked block projects in the ack's turn", () => {
		const { editor, fieldEditor, root, blockId, version } = seed();
		fieldEditor.activate(blockId);
		editor.selectText(blockId, 1, 1);
		expect(fieldEditor.parkedProjectionVersion).not.toBeNull();

		// No flush: the ack itself projects.
		fieldEditor.ackBlockMounted(blockId, mountBlock(root, blockId, "Hi"));
		expect(fieldEditor.parkedProjectionVersion).toBeNull();
		expect(fieldEditor.lastProjectedVersion).toBe(version());
	});

	it("P4: an ack for any other block is a no-op", () => {
		const { editor, fieldEditor, root, blockId } = seed();
		editor.apply([
			{
				type: "insert-block",
				blockId: "other",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		fieldEditor.activate(blockId);
		editor.selectText(blockId, 1, 1);
		const parked = fieldEditor.parkedProjectionVersion;
		expect(parked).not.toBeNull();

		// The parked block's element exists but has not acked; an ack for a
		// different block must not resolve the park through it.
		mountBlock(root, blockId, "Hi");
		fieldEditor.ackBlockMounted("other", mountBlock(root, "other", ""));
		expect(fieldEditor.parkedProjectionVersion).toBe(parked);
		expect(fieldEditor.lastProjectedVersion).toBe(0);
	});

	it("does not write the previous field into a remounted parked target", () => {
		const { editor, fieldEditor, root, blockId: liveId } = seed("Alive");
		editor.apply([
			{
				type: "insert-block",
				blockId: "parked",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "splice-text",
				blockId: "parked",
				from: 0,
				to: 0,
				insert: "Parked",
			},
		]);
		const live = mountBlock(root, liveId, "Alive");
		fieldEditor.activate(liveId);
		editor.selectText("parked", 0, 0);
		flushFrame();
		expect(fieldEditor.parkedProjectionVersion).not.toBeNull();
		expect(fieldEditor.focusBlockId).toBe("parked");

		const remounted = mountBlock(root, "parked", "Parked");
		fieldEditor.ackBlockMounted("parked", remounted);

		const inlineText = (block: HTMLElement) =>
			block.querySelector(`[${DATA_ATTRS.inlineContent}]`)?.textContent;
		expect(inlineText(remounted)).toBe("Parked");
		expect(inlineText(live)).toBe("Alive");
		expect(fieldEditor.focusBlockId).toBe("parked");
	});

	it("resolves waitForAttachment same-turn when the ack never comes", async () => {
		const { editor, fieldEditor, root, blockId, version } = seed("");
		fieldEditor.activate(blockId);
		editor.selectText(blockId, 0, 0);
		flushFrame();
		expect(fieldEditor.parkedProjectionVersion).not.toBeNull();

		expect(await fieldEditor.waitForAttachment(blockId)).toBe(false);
		expect(fieldEditor.parkedProjectionVersion).toBe(version());
		expect(getRootGeometry(root).scheduler.phase).toBe("idle");
	});
});
