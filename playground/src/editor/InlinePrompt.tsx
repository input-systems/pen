import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { AISession } from "@input/pen-ai";
import { useAIContext, useContextualPromptSession } from "@input/pen-react";
import { InlinePromptComposer } from "./InlinePromptComposer";
import { openInlinePrompt } from "./openInlinePrompt";
import { prefersReducedMotion } from "./prefersReducedMotion";

const PLACEHOLDER = "Describe how to edit…";

/**
 * The inline prompt Input's composer uses: Cmd+J (or the wand in the toolbar)
 * opens a box on the current block. Ask for an edit; the answer lands in the
 * document, same path as the agent on the left.
 *
 * The box is inserted in the document flow immediately before the target
 * block, the way Input's intelligence positioner does — not overlaid. That
 * keeps a replacement's new text below the prompt instead of painting above it.
 */
export function InlinePrompt() {
	return (
		<>
			<InlinePromptShortcut />
			<InlinePromptPositioner>
				<InlinePromptComposer placeholder={PLACEHOLDER} />
			</InlinePromptPositioner>
		</>
	);
}

function InlinePromptPositioner({ children }: { children: ReactNode }) {
	const { editor } = useAIContext();
	const session = useContextualPromptSession(editor);
	const markerRef = useRef<HTMLSpanElement>(null);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [portal, setPortal] = useState<HTMLElement | null>(null);
	const blockId = session ? resolveAnchorBlockId(session) : null;

	useLayoutEffect(() => {
		function place() {
			if (!session || blockId == null) {
				hostRef.current?.remove();
				hostRef.current = null;
				setPortal(null);
				return;
			}

			const root =
				markerRef.current?.closest("[data-pen-ai-root]") ??
				markerRef.current?.closest("[data-pen-editor-root]") ??
				null;
			const block = queryAnchorBlock(root, blockId);
			if (!block?.parentElement) {
				return;
			}

			if (!hostRef.current) {
				hostRef.current = document.createElement("div");
				hostRef.current.setAttribute(
					"data-pen-ignore-pointer-gesture",
					"",
				);
				hostRef.current.setAttribute("data-pen-ignore-transfer", "");
			}
			const host = hostRef.current;
			if (block.previousSibling !== host) {
				block.parentElement.insertBefore(host, block);
			}
			if (document.contains(host)) {
				setPortal(host);
			}
		}

		place();
		return editor.on("commit", place);
	}, [blockId, editor, session, session?.id, session?.updatedAt]);

	const sessionId = session?.id;
	const openReason = session?.contextualPrompt?.composer.openReason;

	useEffect(() => {
		if (!portal || sessionId == null) {
			return;
		}
		const frameId = window.requestAnimationFrame(() => {
			portal.scrollIntoView({
				block: "center",
				behavior: prefersReducedMotion() ? "auto" : "smooth",
			});
			// undo-restored review keeps focus in the document so the next
			// cmd+z / redo still hits the editor, the way Input does.
			if (openReason === "history") {
				return;
			}
			const input = portal.querySelector(
				"[data-pen-ai-inline-session-input]",
			);
			if (input instanceof HTMLTextAreaElement) {
				input.focus({ preventScroll: true });
			}
		});
		return () => window.cancelAnimationFrame(frameId);
	}, [openReason, portal, sessionId]);

	useEffect(() => {
		return () => {
			hostRef.current?.remove();
			hostRef.current = null;
		};
	}, []);

	return (
		<>
			<span ref={markerRef} hidden />
			{portal && session
				? createPortal(
						<div
							data-pen-ai-inline-session=""
							data-pen-ignore-pointer-gesture=""
							data-pen-ignore-transfer=""
						>
							{children}
						</div>,
						portal,
					)
				: null}
		</>
	);
}

/**
 * Input's `⌘J` / `Ctrl+J`. The library `SelectionTrigger` only opens when
 * text is highlighted; a caret in a block is enough here, the way the
 * composer works.
 */
function InlinePromptShortcut() {
	const { controller } = useAIContext();

	useEffect(() => {
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (
				shouldIgnoreShortcut(event) ||
				!isAskAiShortcut(event) ||
				controller == null
			) {
				return;
			}
			event.preventDefault();
			openInlinePrompt(controller);
		};

		document.addEventListener("keydown", handleKeyDown, true);
		return () =>
			document.removeEventListener("keydown", handleKeyDown, true);
	}, [controller]);

	return null;
}

function resolveAnchorBlockId(session: AISession): string | null {
	const fromAnchor =
		session.contextualPrompt?.anchor.focusBlockId ??
		session.contextualPrompt?.anchor.selectionSnapshot?.blockRange[0] ??
		session.contextualPrompt?.anchor.selectionSnapshot?.anchor.blockId ??
		null;
	if (fromAnchor) {
		return fromAnchor;
	}
	const target = session.target;
	switch (target.kind) {
		case "block":
			return target.blockId;
		case "selection":
			return target.blockId ?? target.selection.anchor.blockId;
		case "document":
			return null;
		default: {
			const exhaustive: never = target;
			return exhaustive;
		}
	}
}

function queryAnchorBlock(
	root: Element | null,
	blockId: string,
): HTMLElement | null {
	if (!root) {
		return null;
	}
	const content = root.querySelector("[data-pen-editor-content]") ?? root;
	const marked = content.querySelector(
		`[data-block-id="${CSS.escape(blockId)}"]`,
	);
	if (marked instanceof HTMLElement) {
		return marked.closest("[data-pen-editor-block]") ?? marked;
	}
	const fallback = content.querySelector("[data-block-id]");
	if (fallback instanceof HTMLElement) {
		return fallback.closest("[data-pen-editor-block]") ?? fallback;
	}
	return null;
}

const IS_APPLE = /Mac|iPhone|iPad/.test(navigator.userAgent);

function isAskAiShortcut(event: globalThis.KeyboardEvent): boolean {
	if (event.key.toLowerCase() !== "j") {
		return false;
	}
	if (event.altKey || event.shiftKey) {
		return false;
	}
	return IS_APPLE
		? event.metaKey && !event.ctrlKey
		: event.ctrlKey && !event.metaKey;
}

function shouldIgnoreShortcut(event: globalThis.KeyboardEvent): boolean {
	const target = event.target;
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.closest("[data-pen-ai-inline-session]")) {
		return true;
	}
	return (
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLSelectElement
	);
}
