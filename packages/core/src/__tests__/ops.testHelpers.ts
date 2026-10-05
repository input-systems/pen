import { defineBlock, mergeSchemas, SchemaRegistryImpl } from "../index";
import { createEditor as createBaseEditor } from "./editorCore.testHelpers";
import { createDefaultSchema } from "./fixtures/testSchema";

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
	return createBaseEditor();
}

export function createFlowEditor() {
	return createBaseEditor({ schema: flowPolicySchema, documentProfile: "flow" });
}
