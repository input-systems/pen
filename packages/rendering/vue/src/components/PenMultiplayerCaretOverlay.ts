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
 * it does nothing. `glideMs` glides a caret along its line; a new caret, a
 * line change or reduced motion jumps (OV3, AX6).
 */
export const PenMultiplayerCaretOverlay = defineComponent({
	name: "PenMultiplayerCaretOverlay",
	props: {
		glideMs: {
			type: Number,
			default: undefined,
		},
	},
	setup(props) {
		const context = useEditorContext();

		watch(
			[context.rootElement, () => props.glideMs],
			([root, glideMs], _previous, onCleanup) => {
				const overlay = root ? getRootOverlay(root) : null;
				const source = overlay
					? getRemoteCaretSource(context.editor)
					: null;
				if (!overlay || !source) {
					return;
				}
				onCleanup(attachRemoteCarets(overlay, source, { glideMs }));
			},
			{ immediate: true },
		);

		return () => null;
	},
});
