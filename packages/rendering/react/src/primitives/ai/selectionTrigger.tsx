import React from "react";
import { isCollapsed } from "@input/pen-core";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { matchesShortcut } from "../../utils/matchesShortcut";
import { shouldIgnoreAIKeyboardEvent } from "../../utils/aiKeyboardScope";
import { useAIContext } from "./root";

export interface AISelectionTriggerProps extends AsChildProps {
	shortcut?: string;
	ref?: React.Ref<HTMLElement>;
}

export function AISelectionTrigger(props: AISelectionTriggerProps) {
	const { shortcut, ...rest } = props;
	const { controller, editor } = useAIContext();
	const activeSelection = editor.selection;
	const isSelectionEligible =
		activeSelection?.type === "text" && !isCollapsed(activeSelection);
	const openInlineSession = React.useCallback(() => {
		const selection = editor.selection;
		if (selection?.type !== "text" || isCollapsed(selection)) {
			return;
		}
		editor.selectTextRange(selection.anchor, selection.focus);
		controller?.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
	}, [controller, editor]);
	const handleClick = () => {
		openInlineSession();
	};
	const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
		event.preventDefault();
		openInlineSession();
	};

	React.useEffect(() => {
		if (!shortcut) {
			return;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (shouldIgnoreAIKeyboardEvent(editor, event)) {
				return;
			}
			if (!matchesShortcut(event, shortcut)) {
				return;
			}
			event.preventDefault();
			openInlineSession();
		};
		document.addEventListener("keydown", handleKeyDown, true);
		return () =>
			document.removeEventListener("keydown", handleKeyDown, true);
	}, [openInlineSession, shortcut]);
	const triggerProps: AsChildProps & {
		ref?: React.Ref<HTMLElement>;
	} & Record<string, unknown> = {
		...rest,
		onPointerDown: handlePointerDown,
		onClick: handleClick,
	};

	return renderAsChild(triggerProps, "button", {
		type: "button",
		"data-pen-ai-selection-trigger": "",
		disabled: !isSelectionEligible,
	});
}
