import {
	defineBlock,
	mergeSchemas,
	SchemaRegistryImpl,
	createEditor as createCoreEditor,
} from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";

export const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

export const flowDisallowedWidget = defineBlock("widget", {
	content: "none",
	fieldEditor: "none",
	authoring: {
		flowCapability: "flow-disallowed",
	},
});

export const flowPolicySchema = mergeSchemas(
	createDefaultSchema(),
	new SchemaRegistryImpl({
		blocks: [flowDisallowedWidget],
		inlines: [],
	}),
);

export function createEditor() {
	return createCoreEditor({
		schema: createDefaultSchema(),
		preset: noDefaultExtensionsPreset,
	});
}

export function createFlowEditor() {
	return createCoreEditor({
		schema: flowPolicySchema,
		documentProfile: "flow",
		preset: noDefaultExtensionsPreset,
	});
}
