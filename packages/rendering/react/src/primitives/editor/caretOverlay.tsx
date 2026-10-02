import React, { useContext, useEffect, useRef, useState } from "react";
import { isCollapsed, isMultiBlock } from "@input/pen-core";
import {
	createReducedMotionSignal,
	measureWithRoot,
	type Rect,
} from "@input/pen-dom";
import type { Editor, TextSelection } from "@input/pen-types";
import { EditorContext } from "../../context/editorContext";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { useFieldEditorState } from "../../hooks/useFieldEditorState";
import { useOverlayLayout } from "../../hooks/useOverlayLayout";
import { useSelection } from "../../hooks/useSelection";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { DATA_ATTRS } from "@input/pen-dom/utils/dataAttributes";
type CaretStyle = React.CSSProperties & Record<string, string | number>;
const CARET_BLINK_RESUME_DELAY_MS = 500;

export const CARET = {
	DEFAULT: "default",
	MACOS: "macos",
} as const;

export type EditorCaretVariant = (typeof CARET)[keyof typeof CARET];

export interface EditorCaretRenderProps {
	selection: TextSelection;
	point: {
		blockId: string;
		offset: number;
	};
	caretStyle: CaretStyle;
	attributes: Record<string, string | undefined>;
}

export interface EditorCaretOverlayProps extends AsChildProps {
	editor?: Editor;
	variant?: EditorCaretVariant;
	renderCaret?: (props: EditorCaretRenderProps) => React.ReactNode;
	ref?: React.Ref<HTMLElement>;
}

export function EditorCaretOverlay(props: EditorCaretOverlayProps) {
	const {
		editor: editorProp,
		variant = CARET.DEFAULT,
		renderCaret,
		...rest
	} = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? editorContext?.editor;
	const fieldEditor = useFieldEditorContext();

	if (!editor) {
		throw new Error("Missing editor for Pen.Editor.CaretOverlay");
	}

	const selection = useSelection(editor);
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const { elementRef, rootElement, layoutVersion } =
		useOverlayLayout<HTMLElement>([
			selection,
			fieldEditorState.focusBlockId,
			fieldEditorState.isEditing,
			fieldEditorState.isFocused,
			fieldEditorState.isComposing,
			fieldEditorState.mode,
		]);

	const caretSelection = resolveCaretSelection(selection, fieldEditorState);
	const overlayElement = elementRef.current;
	const placement =
		rootElement && overlayElement && caretSelection
			? readCaretRect(rootElement, overlayElement, caretSelection.focus)
			: null;
	const rect = placement?.caret ?? null;
	const overlayOrigin = placement?.origin ?? null;
	const isCaretVisible = caretSelection != null && rect != null;
	const blinkPaused = useCaretBlinkPauseState({
		rootElement,
		layoutVersion,
		caretSelection,
		isCaretVisible,
	});
	const reducedMotion = useReducedMotion(rootElement);

	useEffect(() => {
		if (!rootElement || !isCaretVisible) {
			return;
		}

		const activeSurfaces = Array.from(
			rootElement.querySelectorAll<HTMLElement>(
				`[${DATA_ATTRS.fieldEditorActiveSurface}]`,
			),
		);
		if (activeSurfaces.length === 0) {
			return;
		}

		const previousCaretColors = activeSurfaces.map((surface) => ({
			surface,
			caretColor: surface.style.caretColor,
		}));
		for (const { surface } of previousCaretColors) {
			surface.style.caretColor = "transparent";
		}

		return () => {
			for (const entry of previousCaretColors) {
				entry.surface.style.caretColor = entry.caretColor;
			}
		};
	}, [
		rootElement,
		layoutVersion,
		isCaretVisible,
		caretSelection?.focus.blockId,
		caretSelection?.focus.offset,
	]);

	let caretNode: React.ReactNode = null;
	if (caretSelection && rect && overlayOrigin) {
		const renderProps = createCaretRenderProps(
			caretSelection,
			rect,
			overlayOrigin,
			blinkPaused || reducedMotion,
			variant,
		);
		caretNode = renderCaret ? (
			renderCaret(renderProps)
		) : (
			<div {...renderProps.attributes} style={renderProps.caretStyle} />
		);
	}

	return renderAsChild(
		{
			...rest,
			ref: elementRef,
			children: rest.children ?? caretNode,
		},
		"div",
		{
			"data-pen-editor-caret-overlay": "",
			"data-caret-visible": isCaretVisible ? "" : undefined,
			// AX7 overlay — library caret is presentation
			"aria-hidden": "true",
			style: {
				position: "relative",
				pointerEvents: "none",
			},
		},
	);
}

function resolveCaretSelection(
	selection: ReturnType<typeof useSelection>,
	fieldEditorState: ReturnType<typeof useFieldEditorState>,
): TextSelection | null {
	if (selection?.type !== "text") {
		return null;
	}
	if (!isCollapsed(selection) || isMultiBlock(selection)) {
		return null;
	}
	if (
		!fieldEditorState.isEditing ||
		!fieldEditorState.isFocused ||
		fieldEditorState.isComposing
	) {
		return null;
	}
	return selection;
}

function useReducedMotion(rootElement: HTMLElement | null): boolean {
	const [reduced, setReduced] = useState(false);

	useEffect(() => {
		const signal = createReducedMotionSignal(rootElement ?? undefined);
		setReduced(signal.reduced);
		const unsubscribe = signal.subscribe(() => setReduced(signal.reduced));
		return () => {
			unsubscribe();
			signal.dispose();
		};
	}, [rootElement]);

	return reduced;
}

function readCaretRect(
	root: HTMLElement,
	overlay: HTMLElement,
	point: { blockId: string; offset: number },
): { caret: Rect; origin: DOMRect } | null {
	return measureWithRoot(root, ({ reader }) => {
		const caret = reader.caretRect(point, "downstream");
		if (!caret) {
			return null;
		}
		return { caret, origin: overlay.getBoundingClientRect() };
	});
}

// AX6: `solidCaret` covers both the type-pause and reduced motion. A host that
// supplies --pen-editor-caret-animation must not get it back under reduced
// motion, so this is the only place the token may be written.
function createCaretRenderProps(
	selection: TextSelection,
	rect: Rect,
	overlayOrigin: DOMRectReadOnly,
	solidCaret: boolean,
	variant: EditorCaretVariant,
): EditorCaretRenderProps {
	const height = Math.max(rect.height, 16);
	const point = selection.focus;
	const isMacOS = variant === CARET.MACOS;
	const defaultCaretColor = isMacOS
		? "var(--palette-blue, #0a84ff)"
		: "var(--palette-b100, currentColor)";
	const defaultCaretWidth = isMacOS ? "2px" : "1px";
	const defaultCaretRadius = isMacOS ? "999px" : "0px";
	const caretStyle: CaretStyle = {
		position: "absolute",
		left: `${rect.left - overlayOrigin.left}px`,
		top: `${rect.top - overlayOrigin.top}px`,
		height: `${height}px`,
		width: `var(--pen-editor-caret-width, var(--pen-caret-width, ${defaultCaretWidth}))`,
		borderRadius: `var(--pen-editor-caret-radius, var(--pen-caret-radius, ${defaultCaretRadius}))`,
		background: `var(--pen-editor-caret-color, var(--pen-caret-color, ${defaultCaretColor}))`,
		boxShadow: "var(--pen-editor-caret-shadow, none)",
		animation: solidCaret
			? "none"
			: "var(--pen-editor-caret-animation, none)",
		opacity: "var(--pen-editor-caret-opacity, 1)",
		pointerEvents: "none",
		zIndex: 20,
		"--pen-editor-caret-height": `${height}px`,
	};
	const attributes = {
		"data-pen-editor-caret": "",
		"data-block-id": point.blockId,
		"data-offset": String(point.offset),
	};

	return {
		selection,
		point,
		caretStyle,
		attributes,
	};
}

function useCaretBlinkPauseState(options: {
	rootElement: HTMLElement | null;
	layoutVersion: number;
	caretSelection: TextSelection | null;
	isCaretVisible: boolean;
}): boolean {
	const { rootElement, layoutVersion, caretSelection, isCaretVisible } =
		options;
	const [blinkPaused, setBlinkPaused] = useState(false);
	const resumeTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (resumeTimeoutRef.current == null) {
				return;
			}
			window.clearTimeout(resumeTimeoutRef.current);
		};
	}, []);

	useEffect(() => {
		if (!isCaretVisible) {
			if (resumeTimeoutRef.current != null) {
				window.clearTimeout(resumeTimeoutRef.current);
				resumeTimeoutRef.current = null;
			}
			setBlinkPaused(false);
			return;
		}

		setBlinkPaused(true);
		if (resumeTimeoutRef.current != null) {
			window.clearTimeout(resumeTimeoutRef.current);
		}
		resumeTimeoutRef.current = window.setTimeout(() => {
			resumeTimeoutRef.current = null;
			setBlinkPaused(false);
		}, CARET_BLINK_RESUME_DELAY_MS);
	}, [
		isCaretVisible,
		caretSelection?.focus.blockId,
		caretSelection?.focus.offset,
	]);

	useEffect(() => {
		if (!rootElement || !isCaretVisible) {
			return;
		}

		const activeSurface = rootElement.querySelector<HTMLElement>(
			`[${DATA_ATTRS.fieldEditorActiveSurface}]`,
		);
		if (!activeSurface) {
			return;
		}

		const pauseBlink = () => {
			setBlinkPaused(true);
			if (resumeTimeoutRef.current != null) {
				window.clearTimeout(resumeTimeoutRef.current);
			}
			resumeTimeoutRef.current = window.setTimeout(() => {
				resumeTimeoutRef.current = null;
				setBlinkPaused(false);
			}, CARET_BLINK_RESUME_DELAY_MS);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isModifierOnlyKey(event)) {
				return;
			}
			pauseBlink();
		};

		activeSurface.addEventListener("beforeinput", pauseBlink);
		activeSurface.addEventListener("compositionend", pauseBlink);
		activeSurface.addEventListener("pointerdown", pauseBlink);
		activeSurface.addEventListener("focus", pauseBlink);
		activeSurface.addEventListener("keydown", handleKeyDown);

		return () => {
			activeSurface.removeEventListener("beforeinput", pauseBlink);
			activeSurface.removeEventListener("compositionend", pauseBlink);
			activeSurface.removeEventListener("pointerdown", pauseBlink);
			activeSurface.removeEventListener("focus", pauseBlink);
			activeSurface.removeEventListener("keydown", handleKeyDown);
		};
	}, [rootElement, layoutVersion, isCaretVisible]);

	return blinkPaused;
}

function isModifierOnlyKey(event: KeyboardEvent): boolean {
	return (
		event.key === "Shift" ||
		event.key === "Control" ||
		event.key === "Alt" ||
		event.key === "Meta" ||
		event.key === "CapsLock"
	);
}
