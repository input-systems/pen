import type { Editor } from "@input/pen-types";
import { bump } from "./counters";

/**
 * P1: wraps `editor.on` on the session editor instance before the harness or
 * any surface subscribes, counting live registrations and invocations per
 * event, and the commits' affected-block counts.
 */
const live = new Map<string, number>();

function countCommit(args: unknown[]): void {
	const summary = (args[0] as { summary?: { affectedBlockIds?: readonly string[] } })?.summary;
	bump("commit.affectedBlockIds", summary?.affectedBlockIds?.length ?? 0);
}

export function installEditorListenerProbe(editor: Editor): void {
	const on = editor.on.bind(editor) as (event: string, handler: (...args: unknown[]) => void) => () => void;
	(editor as unknown as { on: typeof on }).on = (event, handler) => {
		live.set(event, (live.get(event) ?? 0) + 1);
		const unsubscribe = on(event, (...args) => {
			bump(`listeners.invoked.${event}`);
			if (event === "commit") countCommit(args);
			return handler(...args);
		});
		let active = true;
		return () => {
			if (active) live.set(event, (live.get(event) ?? 1) - 1);
			active = false;
			unsubscribe();
		};
	};
}

export function readLiveEditorListeners(): Record<string, number> {
	return Object.fromEntries([...live].map(([event, count]) => [`listeners.live.${event}`, count]));
}
