import type { App } from "vue";
import { bump, countBlockRender } from "./counters";

/** P4: Vue component renders, by component name, with the block they render. */
const TRACKED = new Set(["PenBlock", "PenInlineContent", "PenTableCellContent"]);

type Instance = { $options: { name?: string }; $props: { blockId?: unknown } };

const COUNTERS: Readonly<Record<string, (instance: Instance) => void>> = Object.fromEntries([
	["PenContent", () => bump("render.contentRenders")],
	...[...TRACKED].map(
		(name) => [name, (instance: Instance) => countBlockRender(instance.$props?.blockId)] as const,
	),
]);

function countRender(instance: Instance): void {
	COUNTERS[instance.$options.name ?? ""]?.(instance);
}

export function installVueComponentProbe(app: App): void {
	app.mixin({
		mounted(this: Instance) {
			countRender(this);
		},
		updated(this: Instance) {
			countRender(this);
		},
	});
}
