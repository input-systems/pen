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
import { prefersReducedMotion } from "./prefersReducedMotion";

/**
 * Puts the inline prompt in the document flow immediately before the block it
 * targets, the way Input's intelligence positioner does — not overlaid. That
 * keeps a replacement's new text below the prompt instead of painting above
 * it.
 *
 * The host `<div>` is created by hand and inserted into Pen's block list, then
 * used as a portal target. Pen owns that DOM, so the host is re-placed after
 * every commit and removed as soon as the session ends.
 */
export function InlinePromptPositioner({ children }: { children: ReactNode }) {
	const { editor } = useAIContext();
	const session = useContextualPromptSession(editor);
	const markerRef = useRef<HTMLSpanElement>(null);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [portal, setPortal] = useState<HTMLElement | null>(null);

	const blockId = session ? resolveAnchorBlockId(session) : null;
	const sessionId = session?.id;
	const pendingCount = session?.pendingSuggestionIds.length ?? 0;

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
				hostRef.current = createHost();
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

	// Bring the box into view, then focus it — unless a review was restored
	// by undo, where focus stays in the document so redo still hits the editor.
	useEffect(() => {
		if (!portal || sessionId == null) {
			return;
		}
		const frameId = window.requestAnimationFrame(() => {
			portal.scrollIntoView({
				block: "center",
				behavior: prefersReducedMotion() ? "auto" : "smooth",
			});
			if (pendingCount > 0) {
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
	}, [pendingCount, portal, sessionId]);

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

/** Marked so Pen's pointer and clipboard handling leave the box alone. */
function createHost(): HTMLDivElement {
	const host = document.createElement("div");
	host.setAttribute("data-pen-ignore-pointer-gesture", "");
	host.setAttribute("data-pen-ignore-transfer", "");
	return host;
}

function resolveAnchorBlockId(session: AISession): string | null {
	const anchor = session.contextualPrompt?.anchor;
	const fromAnchor =
		anchor?.focusBlockId ??
		anchor?.selectionSnapshot?.blockRange[0] ??
		anchor?.selectionSnapshot?.anchor.blockId ??
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
