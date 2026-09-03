import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { keepCaret } from "./keepCaret";

interface SelectOption {
	value: string;
	label: string;
}

interface SelectProps {
	value: string;
	options: SelectOption[];
	onChange: (value: string) => void;
	/** Accessible name for the trigger. */
	label: string;
	disabled?: boolean;
}

/**
 * Input's `InputSelect`, without Radix.
 *
 * A pill trigger (the same `Button` as the rest of the chrome) and a popover of
 * checked rows. Opening it must not steal the editor caret, so mousedown on the
 * trigger and the items is cancelled — the same rule as the format toggles.
 *
 * Input's version is a Dropdown + checked menu items + a keybinding registry.
 * This one is the geometry: trigger, list, highlight, and Escape to close.
 */
export function Select({
	value,
	options,
	onChange,
	label,
	disabled,
}: SelectProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [highlight, setHighlight] = useState(value);
	const rootRef = useRef<HTMLDivElement>(null);
	const listId = useId();

	const selected = options.find((option) => option.value === value);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		setHighlight(value);

		const closeOnOutside = (event: Event) => {
			if (
				event.target instanceof Node &&
				!rootRef.current?.contains(event.target)
			) {
				setIsOpen(false);
			}
		};

		const handleKeys = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setIsOpen(false);
				return;
			}

			const offset =
				event.key === "ArrowDown"
					? 1
					: event.key === "ArrowUp"
						? -1
						: 0;
			if (offset !== 0) {
				event.preventDefault();
				setHighlight((current) => {
					const index = options.findIndex(
						(option) => option.value === current,
					);
					const next =
						options[
							Math.min(
								Math.max(index + offset, 0),
								options.length - 1,
							)
						];
					return next?.value ?? current;
				});
				return;
			}

			if (event.key === "Enter") {
				event.preventDefault();
				onChange(highlight);
				setIsOpen(false);
			}
		};

		document.addEventListener("mousedown", closeOnOutside);
		document.addEventListener("keydown", handleKeys);
		return () => {
			document.removeEventListener("mousedown", closeOnOutside);
			document.removeEventListener("keydown", handleKeys);
		};
	}, [highlight, isOpen, onChange, options, value]);

	const choose = (next: string) => {
		onChange(next);
		setIsOpen(false);
	};

	const optionItems = options.map((option) => {
		const isSelected = option.value === value;
		const isHighlighted = option.value === highlight;

		return (
			<li key={option.value} role="presentation">
				<button
					type="button"
					role="option"
					className="select-option"
					aria-selected={isSelected}
					data-highlighted={isHighlighted || undefined}
					onMouseDown={keepCaret}
					onMouseEnter={() => setHighlight(option.value)}
					onClick={() => choose(option.value)}
				>
					<span className="select-option-check">
						{isSelected ? <Icon.CheckSmall /> : null}
					</span>
					{option.label}
				</button>
			</li>
		);
	});

	return (
		<div ref={rootRef} className="select" data-open={isOpen || undefined}>
			<Button
				kind="primary"
				size="sm"
				className="select-trigger"
				disabled={disabled}
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={isOpen}
				aria-controls={listId}
				onMouseDown={keepCaret}
				onClick={() => setIsOpen((open) => !open)}
			>
				<span className="select-label">{selected?.label ?? label}</span>
				<span className="select-chevron">
					<Icon.ChevronSmall />
				</span>
			</Button>
			{isOpen ? (
				<ul
					id={listId}
					className="select-menu"
					role="listbox"
					aria-label={label}
				>
					{optionItems}
				</ul>
			) : null}
		</div>
	);
}
