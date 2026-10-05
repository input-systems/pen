import type { SchemaRegistry } from "@input/pen-types";
import { domToBlocks } from "../domToBlocks";
import { parseHTML } from "../domAdapter";
import { sanitizeHTML } from "../sanitize";
import { createDefaultSchema } from "@input/pen-schema";

export const stubRegistry: SchemaRegistry = {
	resolve: () => null,
	resolveInline: () => null,
	resolveApp: () => null,
	resolveLayout: () => null,
	allBlocks: () => [],
	allInlines: () => [],
	allApps: () => [],
	allBlockDisplays: () => [],
};

export function convert(html: string, registry: SchemaRegistry = stubRegistry) {
	const sanitized = sanitizeHTML(html);
	const dom = parseHTML(sanitized);
	return domToBlocks(dom, registry);
}

export const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

export const defaultRegistry = createDefaultSchema();
