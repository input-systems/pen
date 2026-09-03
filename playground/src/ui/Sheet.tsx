import type { ReactNode } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { ScrollArea } from "./ScrollArea";
import { useEscapeKey } from "./useEscapeKey";

interface SheetProps {
	title: string;
	open: boolean;
	onClose: () => void;
	children: ReactNode;
	/** Sits in the header bar, left of the close button. */
	headerActions?: ReactNode;
}

/**
 * A panel that slides in over the right edge, ported from Input's `Sheet`.
 *
 * Input's is a stack: sheets push each other back with a scale and an offset,
 * the width is draggable, and framer-motion animates the entrance. This one
 * holds a single panel at a fixed width, so a CSS transition covers it. The
 * surface is Input's — `--popover-background`, `--popover-shadow`, and the
 * widest radius in the scale.
 *
 * It has no backdrop and does not trap focus: you keep editing while it is open,
 * which is the point of watching document state, so it is a complementary region
 * rather than a dialog. `inert` keeps it out of the tab order while closed.
 */
export function Sheet({
	title,
	open,
	onClose,
	children,
	headerActions,
}: SheetProps) {
	useEscapeKey(open, onClose);

	return (
		<aside
			className="sheet"
			aria-label={title}
			data-open={open || undefined}
			inert={!open}
		>
			<div className="sheet-bar">
				<h4>{title}</h4>
				<div className="sheet-actions">
					{headerActions}
					<Button.Tooltip content="Close" shortcut="Escape">
						<Button.Icon label="Close panel" onClick={onClose}>
							<Icon.Close />
						</Button.Icon>
					</Button.Tooltip>
				</div>
			</div>
			<div className="sheet-body">
				<ScrollArea>{children}</ScrollArea>
			</div>
		</aside>
	);
}
