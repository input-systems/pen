import { FieldEditorImpl } from "@input/pen-dom/field-editor/fieldEditorImpl";
import { bump } from "./counters";

/** P2: field-editor store subscriptions and callback invocations. */
let liveStore = 0;

export function installStoreListenerProbe(): void {
	const prototype = FieldEditorImpl.prototype as unknown as {
		subscribe: (listener: () => void) => () => void;
	};
	const subscribe = prototype.subscribe;
	prototype.subscribe = function (this: unknown, listener: () => void) {
		liveStore += 1;
		const unsubscribe = subscribe.call(this, () => {
			bump("listeners.invoked.store");
			listener();
		});
		let active = true;
		return () => {
			if (active) liveStore -= 1;
			active = false;
			unsubscribe();
		};
	};
}

export function readLiveStoreListeners(): number {
	return liveStore;
}
