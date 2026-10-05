import React from "react";
import type { AISession } from "@input/pen-ai";
import { useIsomorphicLayoutEffect } from "../../hooks/useIsomorphicLayoutEffect";
import { queryBlockElement } from "@input/pen-dom/field-editor/selectionBridge";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import {
	areRectListsEqual,
	resolvePromptHostElement,
	resolvePromptSelectionRects,
} from "./contextualPromptGeometry";
import {
	useContextualPromptPlacement,
	useContextualPromptSession,
} from "./contextualPromptPlacement";
import type {
	ContextualPromptMode,
	ContextualPromptSide,
} from "./contextualPromptTypes";
import { useAIContext } from "./root";
import { isDomHTMLElement } from "@input/pen-dom/utils/domNodes";

export interface AIContextualPromptSurfaceProps extends AsChildProps {
	mode?: ContextualPromptMode;
	side?: ContextualPromptSide;
	sideOffset?: number;
	containerRef?: React.RefObject<HTMLElement | null>;
	ref?: React.Ref<HTMLElement>;
}

export function AIContextualPromptSurface(
	props: AIContextualPromptSurfaceProps,
) {
	const {
		mode = "floating",
		side = "bottom",
		sideOffset = 8,
		containerRef,
		ref,
		...rest
	} = props;
	const { editor } = useAIContext();
	const session = useContextualPromptSession(editor);
	const surfaceRef = React.useRef<HTMLElement | null>(null);
	const [layoutRevision, setLayoutRevision] = React.useState(0);
	const insertedSpacingRef = React.useRef<{
		block: HTMLElement | null;
		reservedSpace: number;
	}>({
		block: null,
		reservedSpace: 0,
	});
	const previousAnchorSpacingRef = React.useRef<{
		block: HTMLElement;
		marginTop: string;
	} | null>(null);
	const layout = useContextualPromptPlacement(editor, {
		layoutRevision,
		mode,
		side,
		sideOffset,
		surfaceRef,
		containerRef,
	});

	useIsomorphicLayoutEffect(() => {
		const previousAnchorSpacing = previousAnchorSpacingRef.current;
		if (previousAnchorSpacing) {
			previousAnchorSpacing.block.style.marginTop =
				previousAnchorSpacing.marginTop;
			delete previousAnchorSpacing.block.dataset.penAiInsertedAnchor;
			previousAnchorSpacingRef.current = null;
		}

		if (
			mode !== "inserted" ||
			!layout?.anchorBlockId ||
			!surfaceRef.current ||
			!layout
		) {
			insertedSpacingRef.current = {
				block: null,
				reservedSpace: 0,
			};
			return;
		}

		const aiRootElement = surfaceRef.current.closest("[data-pen-ai-root]");
		const hostElement =
			aiRootElement?.querySelector("[data-pen-editor-content]") ?? null;
		if (!isDomHTMLElement(hostElement)) {
			return;
		}

		const anchorBlock = queryBlockElement(
			hostElement,
			layout.anchorBlockId,
		);
		if (!isDomHTMLElement(anchorBlock)) {
			return;
		}

		const promptHeight = surfaceRef.current.getBoundingClientRect().height;
		const reservedSpace = Math.ceil(promptHeight + sideOffset);
		const previousInlineMarginTop = anchorBlock.style.marginTop;
		anchorBlock.style.marginTop = `${reservedSpace}px`;
		anchorBlock.dataset.penAiInsertedAnchor = "";
		if (
			insertedSpacingRef.current.block !== anchorBlock ||
			insertedSpacingRef.current.reservedSpace !== reservedSpace
		) {
			insertedSpacingRef.current = {
				block: anchorBlock,
				reservedSpace,
			};
			setLayoutRevision((currentRevision) => currentRevision + 1);
		}
		previousAnchorSpacingRef.current = {
			block: anchorBlock,
			marginTop: previousInlineMarginTop,
		};

		return () => {
			const currentAnchorSpacing = previousAnchorSpacingRef.current;
			if (!currentAnchorSpacing) {
				return;
			}
			currentAnchorSpacing.block.style.marginTop =
				currentAnchorSpacing.marginTop;
			delete currentAnchorSpacing.block.dataset.penAiInsertedAnchor;
			previousAnchorSpacingRef.current = null;
			insertedSpacingRef.current = {
				block: null,
				reservedSpace: 0,
			};
		};
	}, [layout, mode, sideOffset]);

	if (!session || !session.contextualPrompt?.composer.isOpen) {
		return null;
	}

	const pendingReviewCount = session.pendingSuggestionIds.length;
	const selectionOverlay =
		mode !== "inserted" && pendingReviewCount === 0 ? (
			<ContextualPromptSelectionOverlay
				session={session}
				layoutRevision={layoutRevision}
			/>
		) : null;
	const surfaceChildren =
		props.asChild && React.isValidElement(props.children) ? (
			React.cloneElement(
				props.children as React.ReactElement<{
					children?: React.ReactNode;
				}>,
				{},
				<>
					{selectionOverlay}
					{
						(
							props.children as React.ReactElement<{
								children?: React.ReactNode;
							}>
						).props.children
					}
				</>,
			)
		) : (
			<>
				{selectionOverlay}
				{props.children}
			</>
		);

	return renderAsChild(
		{
			...rest,
			ref: mergeRefs(ref, surfaceRef),
			children: surfaceChildren,
		},
		"div",
		{
			"data-pen-ai-contextual-prompt": "",
			"data-pen-ai-inline-session": "",
			"data-session-id": session.id,
			"data-status": session.status,
			"data-side": layout?.side ?? side,
			"data-mode": mode,
			"data-layout-ready": layout ? "" : undefined,
			"data-anchor-block-id": layout?.anchorBlockId,
			"data-pending-count": pendingReviewCount,
			"data-running": session.status === "streaming" ? "" : undefined,
			"data-pen-ignore-pointer-gesture": "",
			"data-pen-ignore-transfer": "",
			style: {
				"--pen-ai-contextual-prompt-top": layout
					? `${Math.round(layout.top)}px`
					: "0px",
				"--pen-ai-inline-session-anchor-top": layout
					? `${Math.round(layout.top)}px`
					: "0px",
				"--pen-ai-contextual-prompt-left": layout
					? `${Math.round(layout.left)}px`
					: "0px",
				"--pen-ai-inline-session-anchor-left": layout
					? `${Math.round(layout.left)}px`
					: "0px",
				"--pen-ai-contextual-prompt-selection-top": layout
					? `${Math.round(layout.anchorRect.top)}px`
					: "0px",
				"--pen-ai-inline-session-selection-top": layout
					? `${Math.round(layout.anchorRect.top)}px`
					: "0px",
				"--pen-ai-contextual-prompt-selection-left": layout
					? `${Math.round(layout.anchorRect.left)}px`
					: "0px",
				"--pen-ai-inline-session-selection-left": layout
					? `${Math.round(layout.anchorRect.left)}px`
					: "0px",
				"--pen-ai-contextual-prompt-selection-width": layout
					? `${Math.round(layout.anchorRect.width)}px`
					: "0px",
				"--pen-ai-inline-session-selection-width": layout
					? `${Math.round(layout.anchorRect.width)}px`
					: "0px",
				"--pen-ai-contextual-prompt-selection-height": layout
					? `${Math.round(layout.anchorRect.height)}px`
					: "0px",
				"--pen-ai-inline-session-selection-height": layout
					? `${Math.round(layout.anchorRect.height)}px`
					: "0px",
			},
		},
	);
}

interface ContextualPromptSelectionOverlayProps {
	session: AISession;
	layoutRevision: number;
}

function ContextualPromptSelectionOverlay(
	props: ContextualPromptSelectionOverlayProps,
) {
	const { session, layoutRevision } = props;
	const { editor } = useAIContext();
	const [segments, setSegments] = React.useState<readonly DOMRect[]>([]);

	useIsomorphicLayoutEffect(() => {
		if (!session.contextualPrompt?.composer.isOpen) {
			setSegments([]);
			return;
		}

		const hostElement = resolvePromptHostElement(editor, session);
		if (!hostElement) {
			setSegments([]);
			return;
		}

		let frameId = 0;
		let resizeObserver: ResizeObserver | null = null;

		const measureSelection = () => {
			const nextSegments = resolvePromptSelectionRects(
				hostElement,
				session,
			);
			setSegments((currentSegments) =>
				areRectListsEqual(currentSegments, nextSegments)
					? currentSegments
					: nextSegments,
			);
		};

		const scheduleMeasure = () => {
			window.cancelAnimationFrame(frameId);
			frameId = window.requestAnimationFrame(measureSelection);
		};

		measureSelection();
		window.addEventListener("resize", scheduleMeasure);
		window.addEventListener("scroll", scheduleMeasure, true);
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				scheduleMeasure();
			});
			resizeObserver.observe(hostElement);
		}

		return () => {
			window.cancelAnimationFrame(frameId);
			window.removeEventListener("resize", scheduleMeasure);
			window.removeEventListener("scroll", scheduleMeasure, true);
			resizeObserver?.disconnect();
		};
	}, [editor, layoutRevision, session]);

	if (segments.length === 0) {
		return null;
	}

	const segmentItems = segments.map((segment, index) => (
		<div
			key={`${index}-${segment.top}-${segment.left}-${segment.width}-${segment.height}`}
			data-pen-ai-contextual-prompt-selection-segment=""
			data-pen-ai-inline-session-selection-segment=""
			// AX7 overlay — selection segment is presentation
			aria-hidden="true"
			style={{
				position: "fixed",
				top: `${segment.top}px`,
				left: `${segment.left}px`,
				width: `${segment.width}px`,
				height: `${segment.height}px`,
				pointerEvents: "none",
				backgroundColor:
					"var(--pen-ai-contextual-prompt-selection-background, #2563eb)",
				background:
					"var(--pen-ai-contextual-prompt-selection-background, color-mix(in srgb, #2563eb 12%, transparent))",
				boxShadow:
					"var(--pen-ai-contextual-prompt-selection-box-shadow, inset 0 0 0 1px rgba(96, 165, 250, 0.72), inset 0 -1px 0 rgba(147, 197, 253, 0.92))",
				borderRadius:
					"var(--pen-ai-contextual-prompt-selection-border-radius, 4px)",
				zIndex: 44,
			}}
		/>
	));

	return (
		<div
			data-pen-ai-contextual-prompt-selection-overlay=""
			data-pen-ai-inline-session-selection-overlay=""
			// AX7 overlay — selection layer is presentation
			aria-hidden="true"
			style={{ pointerEvents: "none" }}
		>
			{segmentItems}
		</div>
	);
}

function mergeRefs<T>(
	...refs: Array<React.Ref<T> | React.MutableRefObject<T | null> | undefined>
): React.RefCallback<T> {
	return (value) => {
		for (const ref of refs) {
			if (!ref) {
				continue;
			}
			if (typeof ref === "function") {
				ref(value);
				continue;
			}
			ref.current = value;
		}
	};
}
