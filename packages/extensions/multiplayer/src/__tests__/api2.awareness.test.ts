import { createEditor } from "@input/pen-core";
import { yjsAdapter } from "@input/pen-yjs";
import { createYjsAwareness } from "@input/pen-yjs/awareness";
import { describe, expect, it } from "vitest";

import { getMultiplayerController, multiplayerExtension } from "../index";

function createAwarenessEditor(crdt?: ReturnType<typeof yjsAdapter>) {
	return createEditor({
		crdt,
		extensions: [
			multiplayerExtension({ user: { id: "u1", name: "Ada" }, autoConnect: false }),
		],
	});
}

describe("@input/pen-multiplayer awareness ownership (API2)", () => {
	it("API2: the extension ensures its scope's awareness when the adapter created none", async () => {
		const editor = createAwarenessEditor();
		await Promise.resolve();

		expect(editor.internals.awareness).not.toBeNull();
		expect(getMultiplayerController(editor)).not.toBeNull();
		editor.destroy();
	});

	it("API2: an awareness the host wired through the adapter is kept", async () => {
		const editor = createAwarenessEditor(yjsAdapter({ awareness: createYjsAwareness }));
		const wired = editor.internals.awareness;
		await Promise.resolve();

		expect(wired).not.toBeNull();
		expect(editor.internals.awareness).toBe(wired);
		editor.destroy();
	});
});
