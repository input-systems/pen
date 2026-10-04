import { loadAllowlistEntries } from "./allowlistLint.js";
import { posixFilename, repoRelativeFilename } from "./lintPaths.js";

/**
 * RI1 (`spec/rules/dom.md`): marks and decorations must not introduce
 * `bidi-override`. Isolate is the allowed unicode-bidi value.
 */

const ALLOWLIST_PATH = "scripts/bidi-override-allowlist.json";

const committedAllowlist = loadAllowlistEntries(ALLOWLIST_PATH);

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
		schema: [
			{
				type: "object",
				properties: { allowlist: { type: "array" } },
				additionalProperties: false,
			},
		],
		messages: {
			override:
				"`bidi-override` in {{file}} is banned (RI1). Use `isolate`. Add an allowlist entry only when the site is justified.",
			unusedAllowlist:
				"RI1 allowlist entry for {{file}} was not consumed. Remove it in the same change that deleted the override.",
		},
	},
	create(context) {
		const filename = context.filename ?? context.getFilename();
		const relative = repoRelativeFilename(filename);
		const allowlist = context.options[0]?.allowlist ?? committedAllowlist;
		const slots = allowlist
			.filter(
				(entry) =>
					entry &&
					typeof entry.file === "string" &&
					posixFilename(entry.file) === relative,
			)
			.map((entry) => ({ ...entry, used: false }));

		function consume() {
			const slot = slots[0];
			if (!slot) {
				return false;
			}
			slot.used = true;
			return true;
		}

		function reportIfOverride(node, value) {
			if (!containsOverride(value)) {
				return;
			}
			if (consume()) {
				return;
			}
			context.report({
				node,
				messageId: "override",
				data: { file: relative },
			});
		}

		return {
			"Program:exit"() {
				for (const slot of slots) {
					if (!slot.used) {
						context.report({
							loc: { line: 1, column: 0 },
							messageId: "unusedAllowlist",
							data: { file: slot.file },
						});
					}
				}
			},
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
