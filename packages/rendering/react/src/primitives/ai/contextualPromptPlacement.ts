import { aiControllerFacet } from "@input/pen-core";
import type { Editor } from "@input/pen-types";
import type {
	AIContextualPromptAnchor,
	AIController,
	AISession,
} from "@input/pen-ai";
import React from "react";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";
import { useSyncExternalStoreWithSelector } from "../../utils/useSyncExternalStoreWithSelector";
import {
	areContextualPromptLayoutsEqual,
	areRectsEqual,
	resolveAnchorRect,
	resolveFallbackRect,
	resolveInsertedAnchorRect,
	resolveLiveSelectionRect,
} from "./contextualPromptGeometry";
import type {
	ContextualPromptPlacement,
	UseContextualPromptPlacementOptions,
} from "./contextualPromptTypes";

const SESSION_VIEWPORT_PADDING = 8;

export function useContextualPromptSession(editor: Editor): AISession | null {
	const controller =
		(editor.facet(aiControllerFacet) as AIController | null) ?? null;

	return useSyncExternalStoreWithSelector(
		(callback) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribeSessions(callback);
		},
		() => controller?.getState() ?? null,
		() => null,
		(state) => {
			const activeSession =
				state?.sessions.find(
					(session) => session.id === state.activeSessionId,
				) ?? null;
			if (
				!activeSession ||
				activeSession.surface !== "inline-edit" ||
				activeSession.status === "cancelled" ||
				!activeSession.contextualPrompt?.composer.isOpen
			) {
				return null;
			}
			return activeSession;
		},
	);
}

export function useContextualPromptAnchor(
	editor: Editor,
	sessionId?: string,
): AIContextualPromptAnchor | null {
	const controller =
		(editor.facet(aiControllerFacet) as AIController | null) ?? null;

	return useSyncExternalStoreWithSelector(
		(callback) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribeSessions(callback);
		},
		() => controller?.getState() ?? null,
		() => null,
		(state) => {
			const session =
				state?.sessions.find((item) =>
					sessionId
						? item.id === sessionId
						: item.id === state.activeSessionId,
				) ?? null;
			return session?.contextualPrompt?.anchor ?? null;
		},
	);
}

export function useContextualPromptPlacement(
	editor: Editor,
	options: UseContextualPromptPlacementOptions = {},
): ContextualPromptPlacement | null {
	const controller =
		(editor.facet(aiControllerFacet) as AIController | null) ?? null;
	const session = useContextualPromptSession(editor);
	const anchor = useContextualPromptAnchor(editor, options.sessionId);
	const {
		mode = "floating",
		side: preferredSide = "bottom",
		sideOffset = 8,
		layoutRevision,
		surfaceRef,
		containerRef,
	} = options;
	const [layout, setLayout] =
		React.useState<ContextualPromptPlacement | null>(null);

	useIsomorphicLayoutEffect(() => {
		const sessionId = options.sessionId ?? session?.id;
		if (!sessionId || !anchor || !surfaceRef?.current) {
			setLayout(null);
			return;
		}

		const aiRootElement = surfaceRef.current.closest("[data-pen-ai-root]");
		const hostElement =
			aiRootElement?.querySelector("[data-pen-editor-content]") ?? null;
		const containerElement =
			containerRef?.current ?? surfaceRef.current.parentElement ?? null;
		if (
			!(hostElement instanceof HTMLElement) ||
			!(containerElement instanceof HTMLElement)
		) {
			setLayout(null);
			return;
		}
		const activeSessionId = sessionId;
		const anchorState = anchor;
		const host = hostElement;
		const container = containerElement;

		let animationFrameId = 0;
		let resizeObserver: ResizeObserver | null = null;

		function measureLayout() {
			const surfaceElement = surfaceRef?.current ?? null;
			if (!surfaceElement) {
				setLayout(null);
				return;
			}

			const surfaceRect = surfaceElement.getBoundingClientRect();
			const hostRect = host.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			const containerScrollTop = container.scrollTop;
			const containerScrollLeft = container.scrollLeft;
			const liveSelectionRect = resolveLiveSelectionRect(
				editor,
				host,
				anchorState.selectionSnapshot,
			);
			const anchorRect =
				mode === "inserted"
					? (resolveInsertedAnchorRect(host, anchorState) ??
						resolveFallbackRect(anchorState.lastResolvedRect) ??
						resolveAnchorRect(host, anchorState))
					: (liveSelectionRect ??
						resolveFallbackRect(anchorState.lastResolvedRect) ??
						resolveAnchorRect(host, anchorState));
			if (!anchorRect) {
				setLayout(null);
				return;
			}

			if (
				mode === "floating" &&
				liveSelectionRect &&
				!areRectsEqual(anchorState.lastResolvedRect, liveSelectionRect)
			) {
				controller?.setContextualPromptAnchorRect(activeSessionId, {
					top: liveSelectionRect.top,
					left: liveSelectionRect.left,
					width: liveSelectionRect.width,
					height: liveSelectionRect.height,
				});
			}

			const anchorTop = anchorRect.top - hostRect.top;
			const anchorBottom = anchorRect.bottom - hostRect.top;
			const anchorLeft = anchorRect.left - hostRect.left;
			const availableWidth = hostRect.width;
			const availableHeight = hostRect.height;
			let side = preferredSide;
			let top =
				mode === "inserted"
					? anchorTop - sideOffset - surfaceRect.height
					: anchorBottom + sideOffset;

			if (mode === "floating") {
				if (side === "top") {
					top = anchorTop - sideOffset - surfaceRect.height;
					if (top < SESSION_VIEWPORT_PADDING) {
						side = "bottom";
						top = anchorBottom + sideOffset;
					}
				} else {
					top = anchorBottom + sideOffset;
					if (
						top + surfaceRect.height >
						availableHeight - SESSION_VIEWPORT_PADDING
					) {
						side = "top";
						top = anchorTop - sideOffset - surfaceRect.height;
					}
				}
			} else {
				side = "top";
			}

			let left =
				anchorLeft + anchorRect.width / 2 - surfaceRect.width / 2;
			left = Math.max(
				SESSION_VIEWPORT_PADDING,
				Math.min(
					left,
					availableWidth -
						surfaceRect.width -
						SESSION_VIEWPORT_PADDING,
				),
			);

			const nextLayout: ContextualPromptPlacement = {
				top:
					hostRect.top - containerRect.top + containerScrollTop + top,
				left:
					hostRect.left -
					containerRect.left +
					containerScrollLeft +
					left,
				side,
				anchorBlockId: anchorState.focusBlockId ?? undefined,
				anchorRect: {
					top:
						hostRect.top -
						containerRect.top +
						containerScrollTop +
						anchorTop,
					left:
						hostRect.left -
						containerRect.left +
						containerScrollLeft +
						anchorLeft,
					width: anchorRect.width,
					height: anchorRect.height,
				},
			};
			setLayout((currentLayout) =>
				areContextualPromptLayoutsEqual(currentLayout, nextLayout)
					? currentLayout
					: nextLayout,
			);
		}

		function scheduleMeasure() {
			window.cancelAnimationFrame(animationFrameId);
			animationFrameId = window.requestAnimationFrame(measureLayout);
		}

		measureLayout();
		window.addEventListener("resize", scheduleMeasure);
		window.addEventListener("scroll", scheduleMeasure, true);
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				scheduleMeasure();
			});
			resizeObserver.observe(surfaceRef.current);
			resizeObserver.observe(host);
			resizeObserver.observe(container);
		}

		return () => {
			window.cancelAnimationFrame(animationFrameId);
			window.removeEventListener("resize", scheduleMeasure);
			window.removeEventListener("scroll", scheduleMeasure, true);
			resizeObserver?.disconnect();
		};
	}, [
		anchor,
		containerRef,
		controller,
		layoutRevision,
		mode,
		options.sessionId,
		preferredSide,
		session?.id,
		sideOffset,
		surfaceRef,
	]);

	return layout;
}
