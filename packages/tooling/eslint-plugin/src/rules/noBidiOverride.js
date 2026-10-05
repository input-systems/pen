import { repoRelativeFilename } from "./lintPaths.js";

/**
 * RI1 (`spec/rules/dom.md`): marks and decorations must not introduce
 * `bidi-override`. Isolate is the allowed unicode-bidi value. There is no
 * allowlist: every site is an error.
 */

function containsOverride(value) {
	return typeof value === "string" && value.includes("bidi-override");
}

export const noBidiOverride = {
	meta: {
		type: "problem",
		docs: {
			description: "Ban unicode-bidi: bidi-override in renderer style",
			specRule: "RI1",
		},
		schema: [],
		messages: {
			override:
				"`bidi-override` in {{file}} is banned (RI1). Use `isolate`.",
		},
	},
	create(context) {
		const relative = repoRelativeFilename(
			context.filename ?? context.getFilename(),
		);

		function reportIfOverride(node, value) {
			if (!containsOverride(value)) {
				return;
			}
			context.report({
				node,
				messageId: "override",
				data: { file: relative },
			});
		}

		return {
			Literal(node) {
				if (typeof node.value === "string") {
					reportIfOverride(node, node.value);
				}
			},
			TemplateElement(node) {
				reportIfOverride(node, node.value?.cooked ?? node.value?.raw);
			},
		};
	},
};
