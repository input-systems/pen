import React from "react";
import { isCollapsed } from "@input/pen-core";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { matchesShortcut } from "../../utils/matchesShortcut";
import { useAIContext } from "./root";

export interface AIContextualPromptTriggerProps extends AsChildProps {
	shortcut?: string;
	ref?: React.Ref<HTMLElement>;
}

export function AIContextualPromptTrigger(
	props: AIContextualPromptTriggerProps,
) {
	const { shortcut, ...rest } = props;
	const { controller, editor } = useAIContext();
	const activeSelection = editor.selection;
	const isSelectionEligible =
		activeSelection?.type === "text" && !isCollapsed(activeSelection);

	const openContextualPrompt = React.useCallback(() => {
		if (!isSelectionEligible) {
			return;
		}
		controller?.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
	}, [controller, isSelectionEligible]);

	const handleClick = () => {
		openContextualPrompt();
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
		event.preventDefault();
		openContextualPrompt();
	};

	React.useEffect(() => {
		if (!shortcut) {
			return;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!matchesShortcut(event, shortcut)) {
				return;
			}
			event.preventDefault();
			openContextualPrompt();
		};
		document.addEventListener("keydown", handleKeyDown, true);
		return () =>
			document.removeEventListener("keydown", handleKeyDown, true);
	}, [openContextualPrompt, shortcut]);

	const triggerProps: AsChildProps & {
		ref?: React.Ref<HTMLElement>;
	} & Record<string, unknown> = {
		...rest,
		onPointerDown: handlePointerDown,
		onClick: handleClick,
	};

	return renderAsChild(triggerProps, "button", {
		type: "button",
		"data-pen-ai-contextual-prompt-trigger": "",
		disabled: !isSelectionEligible,
	});
}
