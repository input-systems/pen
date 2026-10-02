import {
	isGetSelectionCall,
	memberName,
	missingSelectionLintField,
	selectionLintMeta,
	selectionLintTracker,
} from "./selectionLintShared.js";

/**
 * S1 (`spec/rules/selection.md`): one writer. In the renderer packages only
 * the selection projector mutates the DOM selection or an EditContext's
 * selection. Every other site is listed, with the requirement that removes
 * it, in `scripts/dom-selection-write-allowlist.json`; an entry whose site no
 * longer exists fails (I15), so the list only shrinks.
 */

const ALLOWLIST_PATH = "scripts/dom-selection-write-allowlist.json";
const OWNER = "packages/rendering/dom/src/field-editor/selectionProjector.ts";

/** Selection mutators no other type shares. */
const ALWAYS = new Set([
	"removeAllRanges",
	"addRange",
	"setBaseAndExtent",
	"selectAllChildren",
	"collapseToStart",
	"collapseToEnd",
	"setPosition",
	"modify",
]);
/** Shared with Range or others: flagged only on a known Selection receiver. */
const ON_SELECTION = new Set(["extend", "collapse", "empty"]);

function typeName(identifier) {
	const annotation = identifier?.typeAnnotation?.typeAnnotation;
	if (annotation?.type !== "TSTypeReference") return null;
	return annotation.typeName?.type === "Identifier"
		? annotation.typeName.name
		: null;
}

export const missingSelectionWriteField = missingSelectionLintField;

export const noDomSelectionWrite = {
	meta: selectionLintMeta({
		description:
			"Only the selection projector writes the DOM selection (S1)",
		kind: "write",
		violation:
			"`{{api}}` in `{{symbol}}` ({{file}}) writes the selection outside the projector (S1). Write the selection authority and let the projector project it, or add an allowlist entry naming the requirement that removes this site.",
	}),
	create(context) {
		const tracker = selectionLintTracker(context, {
			owner: OWNER,
			allowlistPath: ALLOWLIST_PATH,
			messageId: "write",
		});
		if (!tracker) return {};
		const selectionVariables = new Set();

		const isSelectionReceiver = (receiver) => {
			if (isGetSelectionCall(receiver)) return true;
			if (receiver?.type !== "Identifier") return false;
			return selectionVariables.has(receiver.name);
		};
		const isEditContextReceiver = (receiver) => {
			if (receiver?.type === "Identifier")
				return receiver.name === "editContext";
			return memberName(receiver) === "editContext";
		};
		const writtenApi = (callee) => {
			const name = memberName(callee);
			if (!name) return null;
			if (ALWAYS.has(name)) return name;
			if (ON_SELECTION.has(name) && isSelectionReceiver(callee.object))
				return name;
			if (
				name === "updateSelection" &&
				isEditContextReceiver(callee.object)
			)
				return name;
			return null;
		};

		return {
			...tracker.listeners,
			VariableDeclarator(node) {
				if (
					node.id?.type === "Identifier" &&
					isGetSelectionCall(node.init)
				) {
					selectionVariables.add(node.id.name);
				}
			},
			Identifier(node) {
				if (typeName(node) === "Selection")
					selectionVariables.add(node.name);
			},
			CallExpression(node) {
				const api = writtenApi(node.callee);
				if (api) tracker.report(node, api);
			},
		};
	},
};
