import { DATA_ATTRS } from "./dataAttributes";
import { isDomHTMLElement } from "./domNodes";

export function getSlashMenuOptionId(listboxId: string, index: number): string {
	return `${listboxId}-option-${index}`;
}

export function resolveSlashMenuField(
	from: HTMLElement | null,
): HTMLElement | null {
	const editorRoot = from?.closest(`[${DATA_ATTRS.editorRoot}]`);
	if (!isDomHTMLElement(editorRoot)) {
		return null;
	}
	return (
		editorRoot.querySelector<HTMLElement>(
			`[${DATA_ATTRS.fieldEditorActiveSurface}]`,
		) ?? editorRoot.querySelector<HTMLElement>('[role="textbox"]')
	);
}

export function clearSlashMenuFieldAria(field: HTMLElement | null): void {
	if (!field) {
		return;
	}
	field.removeAttribute("aria-controls");
	field.removeAttribute("aria-expanded");
	field.removeAttribute("aria-activedescendant");
}

export function applySlashMenuFieldAria(
	field: HTMLElement | null,
	listboxId: string,
	activeOptionId: string | undefined,
): void {
	if (!field) {
		return;
	}
	field.setAttribute("aria-controls", listboxId);
	field.setAttribute("aria-expanded", "true");
	if (activeOptionId) {
		field.setAttribute("aria-activedescendant", activeOptionId);
	} else {
		field.removeAttribute("aria-activedescendant");
	}
}
