import { useEffect } from "react";

/** Calls `onEscape` on Escape while `isActive`; used by the sheet and the modal. */
export function useEscapeKey(isActive: boolean, onEscape: () => void): void {
	useEffect(() => {
		if (!isActive) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onEscape();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isActive, onEscape]);
}
