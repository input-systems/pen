import { useId, type ReactNode } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { useEscapeKey } from "./useEscapeKey";

interface ModalProps {
	open: boolean;
	title: string;
	onClose: () => void;
	children: ReactNode;
}

/**
 * A small dialog over a dimmed page, ported from Input's modal surface.
 *
 * Input's is a Radix dialog with focus trap, size variants, and a stack.
 * This one is a single card: Escape or the backdrop closes it. Forms inside
 * it use the `modal-form`, `modal-copy`, `modal-field`, and `modal-actions`
 * classes from `ui.css`.
 */
export function Modal({ open, title, onClose, children }: ModalProps) {
	const titleId = useId();

	useEscapeKey(open, onClose);

	if (!open) {
		return null;
	}

	return (
		<div className="modal-backdrop" onMouseDown={onClose}>
			<div
				className="modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				onMouseDown={(event) => event.stopPropagation()}
			>
				<div className="modal-bar">
					<h2 id={titleId}>{title}</h2>
					<Button.Icon label="Close" onClick={onClose}>
						<Icon.Close />
					</Button.Icon>
				</div>
				{children}
			</div>
		</div>
	);
}
