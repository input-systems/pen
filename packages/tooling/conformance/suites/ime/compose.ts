import type { Page } from "@playwright/test";

export function disableEditContext(): void {
	delete (globalThis as { EditContext?: unknown }).EditContext;
	delete (window as { EditContext?: unknown }).EditContext;
}

export async function readSurfaceText(page: Page): Promise<string> {
	return page.evaluate(
		() =>
			document.querySelector("[data-pen-inline-content]")?.textContent ??
			"",
	);
}

export async function replayCompositionStart(page: Page): Promise<void> {
	await page.evaluate(() => {
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
		);
		if (!(surface instanceof HTMLElement)) {
			throw new Error("no active surface");
		}
		surface.dispatchEvent(
			new CompositionEvent("compositionstart", { bubbles: true }),
		);
	});
}

/**
 * One turn: update + insertCompositionText + DOM append + compositionend.
 * Returns the authority text in that same turn — before any rAF.
 */
export async function replayCompositionCommitSameTurn(
	page: Page,
	text: string,
): Promise<string> {
	return page.evaluate((composed) => {
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
		);
		if (!(surface instanceof HTMLElement)) {
			throw new Error("no active surface");
		}
		surface.dispatchEvent(
			new CompositionEvent("compositionupdate", {
				bubbles: true,
				data: composed,
			}),
		);
		const before = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "insertCompositionText",
			data: composed,
		});
		Object.defineProperty(before, "inputType", {
			configurable: true,
			value: "insertCompositionText",
		});
		surface.dispatchEvent(before);
		const inline = document.querySelector("[data-pen-inline-content]");
		if (inline instanceof HTMLElement) {
			inline.append(composed);
		}
		surface.dispatchEvent(
			new CompositionEvent("compositionend", {
				bubbles: true,
				data: composed,
			}),
		);
		return window.__penConformance.documentText;
	}, text);
}

export async function dispatchComposingKey(
	page: Page,
	key: string,
): Promise<boolean> {
	return page.evaluate((name) => {
		const surface = document.querySelector(
			"[data-pen-field-editor-active-surface], [data-pen-inline-content]",
		);
		if (!(surface instanceof HTMLElement)) {
			throw new Error("no active surface");
		}
		const event = new KeyboardEvent("keydown", {
			key: name,
			bubbles: true,
			cancelable: true,
			composed: true,
		});
		Object.defineProperty(event, "isComposing", {
			configurable: true,
			value: true,
		});
		surface.dispatchEvent(event);
		return event.defaultPrevented;
	}, key);
}

/**
 * An Android virtual keyboard's non-composition key (Gboard's Backspace or
 * Enter): `keydown` with `keyCode` 229 and `key` "Unidentified", then the
 * `beforeinput` it really is, at whatever element owns focus after the
 * keydown. Returns that element's kind.
 */
export async function dispatchUnidentifiedKeyThenInput(
	page: Page,
	inputType: string,
): Promise<{ keydownTarget: string; inputTarget: string }> {
	return page.evaluate((type) => {
		const describe = (element: Element | null): string => {
			if (!(element instanceof HTMLElement)) return "none";
			if (element.hasAttribute("data-pen-focus-sink")) return "sink";
			const block = element.closest("[data-block-id]");
			return block
				? `field:${block.getAttribute("data-block-id")}`
				: element.contentEditable === "true"
					? "host"
					: element.tagName.toLowerCase();
		};
		const keydownTarget = document.activeElement ?? document.body;
		const keydownTargetKind = describe(keydownTarget);
		const keydown = new KeyboardEvent("keydown", {
			key: "Unidentified",
			bubbles: true,
			cancelable: true,
			composed: true,
		});
		for (const name of ["keyCode", "which"]) {
			Object.defineProperty(keydown, name, { configurable: true, value: 229 });
		}
		keydownTarget.dispatchEvent(keydown);
		const inputTarget = document.activeElement ?? document.body;
		inputTarget.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				composed: true,
				inputType: type,
			}),
		);
		return {
			keydownTarget: keydownTargetKind,
			inputTarget: describe(inputTarget),
		};
	}, inputType);
}
