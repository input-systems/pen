import { DATA_ATTRS } from "./dataAttributes";

export function suggestionMenuOptionId(popupId: string, index: number): string {
	return `${popupId}-option-${index}`;
}

export function resolveSuggestionMenuField(
	from: HTMLElement | null,
): HTMLElement | null {
	const editorRoot =
		from?.closest(`[${DATA_ATTRS.editorRoot}]`) ??
		from?.ownerDocument.querySelector(`[${DATA_ATTRS.editorRoot}]`) ??
		(typeof document === "undefined"
			? null
			: document.querySelector(`[${DATA_ATTRS.editorRoot}]`));
	return (
		editorRoot?.querySelector<HTMLElement>(
			`[${DATA_ATTRS.fieldEditorActiveSurface}]`,
		) ?? null
	);
}

export function applySuggestionMenuFieldAria(
	field: HTMLElement,
	popupId: string,
	activeOptionId: string | undefined,
): void {
	field.setAttribute("aria-controls", popupId);
	field.setAttribute("aria-expanded", "true");
	if (activeOptionId) {
		field.setAttribute("aria-activedescendant", activeOptionId);
	} else {
		field.removeAttribute("aria-activedescendant");
	}
}

export function clearSuggestionMenuFieldAria(
	field: HTMLElement | null | undefined,
): void {
	if (!field) {
		return;
	}
	field.removeAttribute("aria-controls");
	field.removeAttribute("aria-expanded");
	field.removeAttribute("aria-activedescendant");
}
