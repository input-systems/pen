import type { Editor, SelectionRecord } from "@input/pen-types";
import { getRootGeometry } from "../geometry/rootGeometry";
import {
	OverlayController,
	type OverlayFieldSource,
} from "./overlayController";
import { createSelectionOverlayContributor } from "./selectionOverlay";
import type { RootOverlay } from "./types";

const overlays = new WeakMap<HTMLElement, OverlayController>();

/**
 * Attach the root's overlay (OV2, SCH3): append the layer as the root's last
 * child and install the controller as the root scheduler's overlay painter.
 * One per root. Re-attaching the same root for the same editor reuses the
 * overlay, so contributors and holds registered against it survive a
 * detach and re-attach; another editor gets a new one. The built-in
 * local-selection contributor is registered once, when the overlay is made.
 * Only `FieldEditorImpl.setRootElement` calls this.
 */
export function attachRootOverlay(options: {
	readonly root: HTMLElement;
	readonly editor: Editor;
	readonly fieldEditor: OverlayFieldSource;
}): {
	readonly overlay: RootOverlay;
	/** Forwarded from the field editor's selection listener (OV4, blink epoch). */
	notifySelectionChange(record: SelectionRecord): void;
	/** Forwarded from the field editor's state emitter: focus, composition, read-only, mode. */
	notifyFieldChange(): void;
	/** A mount ack or similar input change: repaint only when something could be painted. */
	notifyInputsChanged(): void;
	detach(): void;
} {
	const { root } = options;
	let controller = overlays.get(root);
	if (controller && controller.editorInstance !== options.editor) {
		controller.dispose();
		controller = undefined;
	}
	if (!controller) {
		const { reader, scheduler } = getRootGeometry(root);
		controller = new OverlayController({
			root,
			editor: options.editor,
			field: options.fieldEditor,
			reader,
			scheduler,
		});
		controller.registerContributor(createSelectionOverlayContributor());
		overlays.set(root, controller);
	}
	const attached = controller;
	attached.attach(options.fieldEditor);

	let detached = false;
	return {
		overlay: attached,
		notifySelectionChange(record) {
			if (!detached) {
				attached.notifySelectionChange(record);
			}
		},
		notifyFieldChange() {
			if (!detached) {
				attached.notifyFieldChange();
			}
		},
		notifyInputsChanged() {
			if (!detached) {
				attached.requestPaintForInputs();
			}
		},
		detach() {
			if (detached) {
				return;
			}
			detached = true;
			attached.detach();
		},
	};
}

/**
 * The overlay attached to `root`: its layer, paint plan, and contributor
 * API (OV1, OV3). Bindings and extensions register logical requests here
 * and never measure.
 *
 * @param root - An editor root element.
 * @returns The root's overlay, or null when no field editor has attached that root.
 */
export function getRootOverlay(root: HTMLElement): RootOverlay | null {
	const controller = overlays.get(root);
	return controller?.isAttached ? controller : null;
}
