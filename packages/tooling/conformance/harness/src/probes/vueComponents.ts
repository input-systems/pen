import type { App } from "vue";
import { addDistinct, bump } from "./counters";

/** P4: Vue component renders, by component name, with the block they render. */
const TRACKED = new Set(["PenBlock", "PenInlineContent", "PenTableCellContent"]);

type Instance = { $options: { name?: string }; $props: { blockId?: unknown } };

function countBlockRender(instance: Instance): void {
	bump("render.blockRenders");
	const blockId = instance.$props?.blockId;
	if (typeof blockId === "string") addDistinct("render.blocksRendered", blockId);
}

const COUNTERS: Readonly<Record<string, (instance: Instance) => void>> = Object.fromEntries([
	["PenContent", () => bump("render.contentRenders")],
	...[...TRACKED].map((name) => [name, countBlockRender] as const),
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
