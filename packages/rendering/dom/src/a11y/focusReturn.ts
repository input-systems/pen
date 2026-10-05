/**
 * AX3 focus return (D15): where focus goes when a popup, menu or toolbar
 * closes. Callers capture a token when the surface opens and restore it,
 * synchronously, when it closes. No timers and no microtasks (S4): React
 * callers restore after `flushSync` or in a layout effect.
 *
 * Every DOM focus write goes through the field editor's focus controller
 * (`requestRootFocus`), so the focus policy sees it (P, W3.R16).
 */

import type { FieldEditorSession } from "../field-editor/controller";
import {
	isFieldEditorTextEntryTarget,
	isForeignNativeTextEntryTarget,
	isNativeTextEntryTarget,
} from "../utils/textEntryTarget";
import { isDomHTMLElement, isDomNode } from "../utils/domNodes";
import { FOCUS_SINK_ATTR } from "./focusSink";

export interface FocusReturnToken {
	readonly root: HTMLElement;
	/** The element to return to. Recorded at open: `document.activeElement`, or the explicit invoker. */
	readonly target: HTMLElement | null;
}

/** The field editor surface `restoreFocusReturn` focuses through. */
export type FocusReturnFieldEditor = Pick<
	FieldEditorSession,
	"focus" | "requestRootFocus"
>;

export type FocusReturnPreference = "target" | "surface";

export type FocusReturnResult = "target" | "surface" | "none";

export interface FocusReturnOptions {
	/**
	 * The closing surface. Focus inside it is the surface's own, not focus a
	 * native control took meanwhile, so it does not block the return.
	 */
	readonly owner?: Element | null;
}

/** Record where focus should return. Call when the popup or menu opens. */
export function captureFocusReturn(
	root: HTMLElement,
	invoker?: HTMLElement | null,
): FocusReturnToken {
	if (invoker !== undefined) {
		return { root, target: invoker };
	}
	const doc = root.ownerDocument;
	const active = doc.activeElement;
	const target =
		isDomHTMLElement(active) &&
		active !== doc.body &&
		active !== doc.documentElement
			? active
			: null;
	return { root, target };
}

/**
 * Move focus synchronously. With `"target"`: the recorded target when it is
 * connected, enabled, and either inside `root` or not a native text-entry
 * control; otherwise the editor surface. With `"surface"`: the editor
 * surface only — the active field, then the revealed focus sink (block or
 * cell selection), then the root. Never steals focus from a native
 * text-entry control that took focus meanwhile (HOST9).
 */
export function restoreFocusReturn(
	token: FocusReturnToken,
	fieldEditor: FocusReturnFieldEditor | null,
	prefer: FocusReturnPreference,
	options: FocusReturnOptions = {},
): FocusReturnResult {
	const { root, target } = token;
	const doc = root.ownerDocument;
	const active = doc.activeElement;
	if (
		isForeignNativeTextEntryTarget(active, root) &&
		active !== target &&
		!(isDomNode(active) && options.owner?.contains(active))
	) {
		return "none";
	}

	if (prefer === "target" && target && isRestorableTarget(root, target)) {
		// The field is a surface, not a control: focusing it goes through
		// the field editor so the caret is projected with it (P1).
		if (isFieldEditorTextEntryTarget(target)) {
			return focusEditorSurface(root, fieldEditor);
		}
		if (doc.activeElement === target) {
			return "target";
		}
		fieldEditor?.requestRootFocus(target, "restore", {
			preventScroll: true,
		});
		if (doc.activeElement === target) {
			return "target";
		}
	}

	return focusEditorSurface(root, fieldEditor);
}

function isRestorableTarget(root: HTMLElement, target: HTMLElement): boolean {
	if (!target.isConnected || target.closest("[inert]")) {
		return false;
	}
	if ("disabled" in target && (target as HTMLButtonElement).disabled) {
		return false;
	}
	// HOST9: a native text-entry control outside the editor is host chrome.
	return root.contains(target) || !isNativeTextEntryTarget(target);
}

function focusEditorSurface(
	root: HTMLElement,
	fieldEditor: FocusReturnFieldEditor | null,
): FocusReturnResult {
	if (!root.isConnected) {
		return "none";
	}
	if (fieldEditor?.focus({ reason: "keyboard", domFocus: true })) {
		return "surface";
	}
	const sink = root.querySelector<HTMLElement>(
		`:scope > [${FOCUS_SINK_ATTR}]`,
	);
	// The sink is revealed only while a block or cell selection holds it (AX1).
	const surface =
		sink && sink.getAttribute("aria-hidden") !== "true" ? sink : root;
	if (!fieldEditor) {
		return "none";
	}
	fieldEditor.requestRootFocus(surface, "restore", { preventScroll: true });
	return root.ownerDocument.activeElement === surface ? "surface" : "none";
}
