import { type BlockSchema, isNestedContent } from "@input/pen-types";

type RuntimeContentType =
	| "inline"
	| "none"
	| "table"
	| "subdocument"
	| "nested";

export function resolveRuntimeContentType(
	schema: Pick<BlockSchema, "content"> | null | undefined,
): RuntimeContentType {
	if (!schema) {
		return "none";
	}

	if (Array.isArray(schema.content)) {
		return "nested";
	}

	return schema.content;
}

/**
 * Whether a block type holds child blocks, by either route: a nested-content
 * schema, or the `parentId` convention that `isContainer` marks.
 *
 * This is the single authority for the question. Callers must not test block
 * type names — a hardcoded set silently excludes every host-defined container.
 */
export function isContainerBlock(
	schema: BlockSchema | null | undefined,
): boolean {
	if (!schema) return false;
	return isNestedContent(schema.content) || schema.isContainer === true;
}
