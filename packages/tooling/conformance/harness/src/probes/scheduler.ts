import { getRootGeometry } from "@input/pen-dom";
import { bump } from "./counters";

/**
 * P7: measureNow calls on the editor root's scheduler, and whether a flush is
 * running (for the geometry probe's in/out-of-flush split), through the same
 * `_phase` accessor patch the typing-budget probe uses. Flushes are not
 * counted: how many land in the probe window depends on frame timing, so the
 * count was not deterministic (CH8, CH9).
 */
type Scheduler = { _phase: string; diagnostics: { measureNowCount: number } };

let phase = "idle";
let patched: Scheduler | null = null;
let measureNowAtBegin = 0;

export function isInFlush(): boolean {
	return phase !== "idle";
}

function schedulerFor(root: HTMLElement): Scheduler {
	return (getRootGeometry(root) as unknown as { scheduler: Scheduler }).scheduler;
}

function patchPhase(scheduler: Scheduler): void {
	phase = scheduler._phase;
	Object.defineProperty(scheduler, "_phase", {
		configurable: true,
		get: () => phase,
		set: (next: string) => {
			phase = next;
		},
	});
	patched = scheduler;
}

export function beginSchedulerProbe(): void {
	const root = document.querySelector<HTMLElement>("[data-pen-editor-root]");
	if (!root) throw new Error("scale probe: no editor root");
	const scheduler = schedulerFor(root);
	if (patched !== scheduler) patchPhase(scheduler);
	measureNowAtBegin = scheduler.diagnostics.measureNowCount;
}

export function endSchedulerProbe(): void {
	if (!patched) return;
	bump("scheduler.measureNow", patched.diagnostics.measureNowCount - measureNowAtBegin);
}
