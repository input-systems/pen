import type { Editor, SelectionRecord } from "@input/pen-types";
import { holdRootGeometry } from "../geometry/rootGeometry";
import {
	OverlayController,
	type OverlayFieldSource,
} from "./overlayController";
import { createSelectionOverlayContributor } from "./selectionOverlay";
import type { RootOverlay } from "./types";

/** Attached overlays, by root. */
const overlays = new WeakMap<HTMLElement, OverlayController>();

/**
 * Detached overlays, by editor and then root. A detach moves the overlay
 * here so a root that outlives its editor holds no path to the editor or
 * its field editor; a re-attach of the same root by the same editor (React
 * Strict Mode) takes it back, contributors and holds intact. Keyed on the
 * editor first, so the whole entry goes once the host drops the editor.
 */
const detachedOverlays = new WeakMap<
	Editor,
	WeakMap<HTMLElement, OverlayController>
>();

function takeDetachedOverlay(
	editor: Editor,
	root: HTMLElement,
): OverlayController | undefined {
	const byRoot = detachedOverlays.get(editor);
	const controller = byRoot?.get(root);
	byRoot?.delete(root);
	return controller;
}

function keepDetachedOverlay(
	editor: Editor,
	root: HTMLElement,
	controller: OverlayController,
): void {
	let byRoot = detachedOverlays.get(editor);
	if (!byRoot) {
		byRoot = new WeakMap();
		detachedOverlays.set(editor, byRoot);
	}
	byRoot.set(root, controller);
}

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
	/** A mount ack or similar input change: repaint only when something is painted or unresolved. */
	notifyInputsChanged(): void;
	detach(): void;
} {
	const { root, editor } = options;
	let controller = overlays.get(root);
	if (controller && controller.editorInstance !== editor) {
		controller.dispose();
		controller = undefined;
	}
	controller ??= takeDetachedOverlay(editor, root);
	const geometryHold = holdRootGeometry(root);
	if (!controller) {
		controller = new OverlayController({
			root,
			editor,
			field: options.fieldEditor,
			reader: geometryHold.geometry.reader,
			scheduler: geometryHold.geometry.scheduler,
		});
		controller.registerContributor(createSelectionOverlayContributor());
	}
	overlays.set(root, controller);
	const attached = controller;
	attached.attach(options.fieldEditor, geometryHold.geometry);

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
			if (overlays.get(root) === attached) {
				overlays.delete(root);
				keepDetachedOverlay(editor, root, attached);
			}
			geometryHold.release();
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
