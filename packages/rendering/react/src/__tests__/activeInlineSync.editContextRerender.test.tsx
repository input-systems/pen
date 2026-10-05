// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { Pen } from "../primitives/index";
import { FakeEditContext } from "./utils/fakeEditContext";
import { defaultSchema } from "@input/pen-schema";
import {
	createEditor,
	flushAnimationFrames,
	getFieldEditor,
} from "./utils/selectionDeletionTestHelpers";
describe("@input/pen-react active inline sync: EditContext across rerenders", () => {
	it("keeps active EditContext text visible after a parent rerender", async () => {
		const originalEditContext = (
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext;
		(
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext = FakeEditContext;

		const editor = createEditor({ schema: defaultSchema });
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		function RerenderingEditor() {
			const [, setCommitCount] = React.useState(0);

			React.useEffect(
				() =>
					editor.on("commit", () =>
						setCommitCount((count) => count + 1),
					),
				[],
			);

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		try {
			await act(async () => {
				root.render(<RerenderingEditor />);
			});

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as
				| (HTMLElement & { editContext?: FakeEditContext | null })
				| null;
			const rootElement = container.querySelector(
				"[data-pen-editor-root]",
			) as HTMLElement | null;

			expect(inlineElement).not.toBeNull();
			expect(rootElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activate(blockId);
				await flushAnimationFrames(2);
			});

			const editContext = inlineElement!.editContext;
			expect(editContext).toBeInstanceOf(FakeEditContext);

			await act(async () => {
				for (const character of "Hello") {
					const start = editContext!.selectionStart;
					const end = editContext!.selectionEnd;
					editContext!.emit("textupdate", {
						updateRangeStart: start,
						updateRangeEnd: end,
						text: character,
						selectionStart: start + character.length,
						selectionEnd: start + character.length,
					});
					await flushAnimationFrames(1);
				}
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
			expect(inlineElement!.textContent).toBe("Hello");
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
			(
				globalThis as typeof globalThis & {
					EditContext?: typeof FakeEditContext;
				}
			).EditContext = originalEditContext;
		}
	});
});
