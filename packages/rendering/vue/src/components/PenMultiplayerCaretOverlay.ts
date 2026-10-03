import {
	attachRemoteCarets,
	getRemoteCaretSource,
	getRootOverlay,
} from "@input/pen-dom";
import { defineComponent, watch } from "vue";
import { useEditorContext } from "../internal/editorContext";

/**
 * Remote collaborator carets as a binding over `@input/pen-dom`'s root
 * overlay (OV3). Place it inside `PenEditor`: while mounted, the editor's
 * `@input/pen-multiplayer` cursors are a registered contributor, and pen-dom
 * measures and paints each caret and its name label into the overlay layer.
 * It renders nothing and measures nothing; without a multiplayer controller
 * it does nothing.
 */
export const PenMultiplayerCaretOverlay = defineComponent({
	name: "PenMultiplayerCaretOverlay",
	setup() {
		const context = useEditorContext();

		watch(
			context.rootElement,
			(root, _previous, onCleanup) => {
				const overlay = root ? getRootOverlay(root) : null;
				const source = overlay
					? getRemoteCaretSource(context.editor)
					: null;
				if (!overlay || !source) {
					return;
				}
				onCleanup(attachRemoteCarets(overlay, source));
			},
			{ immediate: true },
		);

		return () => null;
	},
});
