import { describe, expect, it } from "vitest";
import type { BlockSchema, ContentType, PropSchema } from "@input/pen-types";
import {
	getBlockContentRole,
	getBlockSelectionRoleFromSchema,
	getBlockSelectionRoleFromType,
	getFlowCapabilityFromSchema,
	getFlowCapabilityFromType,
	isContinuousTextFlowCapability,
	shouldAllowDirectBlockPaste,
	shouldAllowFlowInsertionInSlashMenu,
	shouldExposeBlockInTooling,
	shouldForceBlockScopedSelectAll,
	shouldShowBlockInDefaultMenus,
} from "../editor/profilePolicy";

function block(
	type: string,
	config: {
		content?: ContentType;
		fieldEditor?: BlockSchema["fieldEditor"];
		authoring?: BlockSchema["authoring"];
		display?: BlockSchema["display"];
	} = {},
): BlockSchema<string, Record<string, PropSchema>, ContentType> {
	return {
		type,
		propSchema: {},
		content: config.content ?? "inline",
		fieldEditor: config.fieldEditor,
		serialize: {},
		authoring: config.authoring,
		display: config.display,
	};
}

describe("block capability helpers", () => {
	it("respects explicit authoring metadata", () => {
		const schema = block("subdocument", {
			content: "subdocument",
			fieldEditor: "none",
			authoring: {
				flowCapability: "flow-delegated",
				selectionRole: "delegated",
			},
		});

		expect(getFlowCapabilityFromSchema(schema)).toBe("flow-delegated");
		expect(getBlockSelectionRoleFromSchema(schema)).toBe("delegated");
		expect(getBlockContentRole(schema)).toBe("content");
	});

	it("defaults contentRole to content and honors explicit chrome", () => {
		expect(getBlockContentRole(block("paragraph"))).toBe("content");
		expect(
			getBlockContentRole(
				block("signature", {
					content: "none",
					fieldEditor: "none",
					authoring: {
						contentRole: "chrome",
					},
				}),
			),
		).toBe("chrome");
		expect(getBlockContentRole(null)).toBe(null);
		expect(getBlockContentRole(undefined)).toBe(null);
	});

	it("keeps code editors inline-editable by default", () => {
		const schema = block("codeBlock", {
			content: "inline",
			fieldEditor: "code",
			authoring: {
				selectionRole: "delegated",
			},
		});

		expect(getFlowCapabilityFromSchema(schema)).toBe("flow-inline");
		expect(getBlockSelectionRoleFromSchema(schema)).toBe("delegated");
	});

	it("keeps only explicit legacy type fallbacks for schema-less payloads", () => {
		expect(getFlowCapabilityFromType("table")).toBe("flow-delegated");
		expect(getFlowCapabilityFromType("subdocument")).toBe("flow-delegated");
		expect(getFlowCapabilityFromType("customWidget")).toBe(null);
		expect(getBlockSelectionRoleFromType("image")).toBe("structural");
		expect(getBlockSelectionRoleFromType("codeBlock")).toBe("delegated");
	});

	it("hides hidden and subdocument blocks from default menus", () => {
		const hiddenBlock = block("hiddenBlock", {
			content: "inline",
			display: {
				title: "Hidden Block",
				hidden: true,
			},
		});
		const subdocumentBlock = block("subdocument", {
			content: "subdocument",
			fieldEditor: "subdocument",
			display: {
				title: "Subdocument",
			},
		});

		expect(shouldShowBlockInDefaultMenus("structured", hiddenBlock)).toBe(
			false,
		);
		expect(
			shouldShowBlockInDefaultMenus("structured", subdocumentBlock),
		).toBe(false);
	});

	it("filters hidden and flow-disallowed blocks from tooling surfaces", () => {
		const hiddenBlock = block("hiddenBlock", {
			content: "inline",
			display: {
				title: "Hidden Block",
				hidden: true,
			},
		});
		const disallowedBlock = block("widget", {
			content: "none",
			fieldEditor: "none",
			authoring: {
				flowCapability: "flow-disallowed",
			},
			display: {
				title: "Widget",
			},
		});

		expect(shouldExposeBlockInTooling("structured", hiddenBlock)).toBe(
			false,
		);
		expect(shouldExposeBlockInTooling("structured", disallowedBlock)).toBe(
			true,
		);
		expect(shouldExposeBlockInTooling("flow", disallowedBlock)).toBe(false);
	});

	it("treats unknown block capabilities as ineligible for direct flow paste", () => {
		expect(shouldAllowDirectBlockPaste("flow", null)).toBe(false);
		expect(shouldAllowDirectBlockPaste("flow", "flow-inline")).toBe(true);
	});

	it("isContinuousTextFlowCapability is true only for flow-inline", () => {
		expect(isContinuousTextFlowCapability("flow-inline")).toBe(true);
		expect(isContinuousTextFlowCapability("flow-delegated")).toBe(false);
		expect(isContinuousTextFlowCapability("flow-structural")).toBe(false);
		expect(isContinuousTextFlowCapability("flow-disallowed")).toBe(false);
		expect(isContinuousTextFlowCapability(null)).toBe(false);
	});

	it("shouldAllowFlowInsertionInSlashMenu denies only flow-disallowed in flow documents", () => {
		expect(
			shouldAllowFlowInsertionInSlashMenu(
				"structured",
				"flow-disallowed",
			),
		).toBe(true);
		expect(
			shouldAllowFlowInsertionInSlashMenu("flow", "flow-disallowed"),
		).toBe(false);
		expect(shouldAllowFlowInsertionInSlashMenu("flow", "flow-inline")).toBe(
			true,
		);
	});

	it("shouldForceBlockScopedSelectAll is flow-only for structural and disallowed", () => {
		expect(shouldForceBlockScopedSelectAll("flow", "flow-structural")).toBe(
			true,
		);
		expect(shouldForceBlockScopedSelectAll("flow", "flow-disallowed")).toBe(
			true,
		);
		expect(shouldForceBlockScopedSelectAll("flow", "flow-inline")).toBe(
			false,
		);
		expect(
			shouldForceBlockScopedSelectAll("structured", "flow-structural"),
		).toBe(false);
	});
});
