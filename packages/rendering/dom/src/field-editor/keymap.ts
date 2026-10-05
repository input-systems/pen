import {
	resolveDefaultKeymap,
	resolveDirectedBinding,
	resolveDirectedCommand,
	type DefaultKeymapContext,
	type KeymapPlatform,
} from "@input/pen-core";
import type { Command, Editor } from "@input/pen-types";

import { dispatchEditorCommand } from "./commandDispatch";

export type KeymapDirection = "ltr" | "rtl";

export interface KeymapBinding {
	readonly key: string;
	readonly command: Command<unknown>;
}

export interface KeymapEvent {
	readonly key: string;
	readonly altKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly shiftKey?: boolean;
}

export interface ResolveKeymapOptions {
	readonly composing: boolean;
	readonly direction?: KeymapDirection;
}

/**
 * Standalone keymap resolver (K1, K4, M2). Matches bindings in the given
 * order and returns the first command name, or null. Direction remaps the
 * matched command after the key match (M2) so other bindings on that key
 * stay intact. Does not attach listeners or dispatch.
 */
export function resolveKeymap(
	bindings: readonly KeymapBinding[],
	event: KeymapEvent,
	options: ResolveKeymapOptions,
): string | null {
	if (options.composing && event.key !== "Escape") {
		return null;
	}

	for (const binding of bindings) {
		if (matchesKey(binding.key, event)) {
			const command = resolveDirectedCommand(
				binding.command,
				options.direction ?? "ltr",
			);
			return command.name;
		}
	}

	return null;
}

export interface DispatchKeymapEventOptions {
	readonly composing: boolean;
	readonly context?: DefaultKeymapContext;
}

/**
 * K1 live dispatch: resolve the default keymap, try each matching binding
 * until one handler succeeds, and remap the command for rtl after the key
 * match (M2). Does not attach listeners.
 */
export function dispatchKeymapEvent(
	editor: Editor,
	event: KeymapEvent,
	options: DispatchKeymapEventOptions,
): boolean {
	if (options.composing && event.key !== "Escape") {
		return false;
	}

	const context = options.context ?? "text";
	for (const binding of resolveDefaultKeymap(detectKeymapPlatform())) {
		if (!matchesKey(binding.key, event)) {
			continue;
		}
		if (!matchesKeymapBindingContext(binding.context, context)) {
			continue;
		}
		const directed = resolveDirectedBinding(editor, binding);
		if (
			dispatchEditorCommand(
				editor,
				directed.command,
				directed.param as never,
				{ origin: "user", fromKeymap: true },
			)
		) {
			return true;
		}
	}

	return false;
}

function matchesKeymapBindingContext(
	bindingContext: DefaultKeymapContext | undefined,
	current: DefaultKeymapContext,
): boolean {
	if (!bindingContext || bindingContext === "any") {
		return true;
	}
	return bindingContext === current;
}

function detectKeymapPlatform(): KeymapPlatform {
	if (typeof navigator === "undefined") {
		return "linux";
	}
	const platform = navigator.platform ?? "";
	if (/Mac|iPhone|iPad/.test(platform)) {
		return "macos";
	}
	if (/Win/.test(platform)) {
		return "windows";
	}
	return "linux";
}

/** Matches a `mod-shift-z` style key pattern; `mod` is Cmd on Apple platforms, Ctrl elsewhere. */
export function matchesKey(pattern: string, event: KeymapEvent): boolean {
	const parts = pattern.split("-").map((part) => part.toLowerCase());
	const key = parts.pop()?.toLowerCase() ?? "";

	const needsCtrl = parts.includes("ctrl");
	const needsMeta = parts.includes("meta");
	const needsMod = parts.includes("mod");
	const needsShift = parts.includes("shift");
	const needsAlt = parts.includes("alt");

	const isMac =
		typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad/.test(navigator.platform ?? "");

	const allowCtrl = needsCtrl || (needsMod && !isMac);
	const allowMeta = needsMeta || (needsMod && isMac);
	const ctrlKey = event.ctrlKey === true;
	const metaKey = event.metaKey === true;
	const shiftKey = event.shiftKey === true;
	const altKey = event.altKey === true;

	const modMatch = needsMod ? (isMac ? metaKey : ctrlKey) : true;
	const ctrlMatch = allowCtrl ? ctrlKey : !ctrlKey;
	const metaMatch = allowMeta ? metaKey : !metaKey;
	const shiftMatch = needsShift ? shiftKey : !shiftKey;
	const altMatch = needsAlt ? altKey : !altKey;

	return (
		modMatch &&
		ctrlMatch &&
		metaMatch &&
		shiftMatch &&
		altMatch &&
		event.key.toLowerCase() === key
	);
}
