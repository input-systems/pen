import type { Editor, Unsubscribe } from "@input/pen-types";
import { isDomHTMLElement } from "../utils/domNodes";
import type {
	FieldEditorFocusReason,
	FieldEditorFocusRequest,
	PenFieldEditorFocusOptions,
	PenFocusAction,
	PenFocusDecision,
	PenFocusLifecycleEvent,
	PenFocusLifecycleListener,
	PenFocusPolicy,
	PenFocusReason,
} from "./controller";

type FocusControllerOptions = {
	editor: Editor;
	getRootElement: () => HTMLElement | null;
	getFocusBlockId: () => string | null;
	getAttachedElement: () => HTMLElement | null;
};

const ALLOW_FOCUS_DECISION: PenFocusDecision = { type: "allow" };

export class FocusController {
	private readonly _editor: Editor;
	private readonly _getRootElement: () => HTMLElement | null;
	private readonly _getFocusBlockId: () => string | null;
	private readonly _getAttachedElement: () => HTMLElement | null;
	private _focusPolicy: PenFocusPolicy | undefined;
	private readonly _focusLifecycleListeners =
		new Set<PenFocusLifecycleListener>();

	constructor(options: FocusControllerOptions) {
		this._editor = options.editor;
		this._getRootElement = options.getRootElement;
		this._getFocusBlockId = options.getFocusBlockId;
		this._getAttachedElement = options.getAttachedElement;
	}

	setFocusPolicy(focusPolicy: PenFocusPolicy | undefined): void {
		this._focusPolicy = focusPolicy;
	}

	requestDomFocus(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options?: FocusOptions,
		policyOptions: PenFieldEditorFocusOptions = {},
	): boolean {
		const decision = this._decide(target, reason, policyOptions);
		if (decision === "allow") {
			target.focus(options);
		}
		return decision !== "deny";
	}

	requestActivation(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options: PenFieldEditorFocusOptions = {},
	): boolean {
		return this._decide(target, reason, options) !== "deny";
	}

	requestRootFocus(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options?: FocusOptions,
	): boolean {
		return this.requestDomFocus(target, reason, options);
	}

	blur(): void {
		const root = this._getRootElement();
		if (!root) return;
		const activeEl = root.ownerDocument?.activeElement;
		if (isDomHTMLElement(activeEl) && root.contains(activeEl)) {
			activeEl.blur();
		}
	}

	notifyRootAttached(root: HTMLElement): void {
		this.emitLifecycle({
			type: "field-editor-attached",
			editor: this._editor,
			root,
		});
	}

	waitForAttachment(
		blockId: string | null = this._getFocusBlockId(),
	): Promise<boolean> {
		return Promise.resolve(this.isAttached(blockId));
	}

	/** Whether the field for `blockId` (or the focused one) is attached now. */
	isAttached(blockId: string | null = this._getFocusBlockId()): boolean {
		const attachedElement = this._getAttachedElement();
		return (
			attachedElement?.isConnected === true &&
			(blockId == null || this._getFocusBlockId() === blockId)
		);
	}

	onFocusLifecycle(listener: PenFocusLifecycleListener): Unsubscribe {
		this._focusLifecycleListeners.add(listener);
		return () => this._focusLifecycleListeners.delete(listener);
	}

	emitLifecycle(event: PenFocusLifecycleEvent): void {
		for (const listener of this._focusLifecycleListeners) {
			listener(event);
		}
	}

	destroy(): void {
		this._focusLifecycleListeners.clear();
	}

	private _createFocusRequest(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options: PenFieldEditorFocusOptions = {},
	): FieldEditorFocusRequest {
		return {
			editor: this._editor,
			target,
			root: this._getRootElement(),
			reason,
			action: resolvePenFocusAction(reason),
			source: options.reason ?? resolvePenFocusReason(reason),
			blockId: this._getFocusBlockId(),
			passive: options.passive ?? options.domFocus === false,
		};
	}

	/** Decides a focus request; a denied one is reported. `allow` means move focus now. */
	private _decide(
		target: HTMLElement,
		reason: FieldEditorFocusReason,
		options: PenFieldEditorFocusOptions,
	): PenFocusDecision["type"] {
		const request = this._createFocusRequest(target, reason, options);
		const decision = this._decideFocus(request);
		if (decision.type === "deny") {
			this._emitFocusDenied(request);
		}
		return decision.type;
	}

	private _decideFocus(request: FieldEditorFocusRequest): PenFocusDecision {
		const policyDecision = this._focusPolicy?.decide(request);
		if (policyDecision) {
			return request.passive && policyDecision.type === "allow"
				? { type: "allow-passive" }
				: policyDecision;
		}

		return request.passive
			? { type: "allow-passive" }
			: ALLOW_FOCUS_DECISION;
	}

	private _emitFocusDenied(request: FieldEditorFocusRequest): void {
		this._focusPolicy?.onDenied?.(request);
		this.emitLifecycle({
			type: "focus-request-denied",
			request,
		});
	}
}

function resolvePenFocusAction(reason: FieldEditorFocusReason): PenFocusAction {
	switch (reason) {
		case "backend-attach":
		case "backend-activate":
			return "attach-backend";
		case "selection-project":
		case "selection-activate":
		case "selection-sync":
			return "project-selection";
		case "restore":
			return "restore";
		case "select-all":
			return "select-all";
		case "activate":
		case "cell":
			return "activate";
	}
}

function resolvePenFocusReason(reason: FieldEditorFocusReason): PenFocusReason {
	switch (reason) {
		case "backend-attach":
		case "backend-activate":
			return "backend";
		case "selection-project":
		case "selection-activate":
		case "selection-sync":
			return "selection-sync";
		case "select-all":
		case "cell":
			return "keyboard";
		case "activate":
		case "restore":
			return "programmatic";
	}
}
