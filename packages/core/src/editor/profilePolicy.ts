import type {
	BlockAuthoring,
	BlockContentRole,
	BlockSelectionRole,
	DocumentOp,
	DocumentProfile,
	Editor,
	FlowBlockCapability,
	ImportResult,
	InsertBlockOp,
	SchemaRegistry,
	SetPropsOp,
} from "@input/pen-types";
import type { PendingBlock } from "../importerUtils";

type BlockSchemaCapabilityLike =
	| {
			authoring?: BlockAuthoring;
			content?: string | unknown[];
			display?: { hidden?: boolean };
			fieldEditor?: string;
	  }
	| null
	| undefined;

export function getFlowCapabilityFromSchema(
	schema: BlockSchemaCapabilityLike,
): FlowBlockCapability | null {
	if (!schema) {
		return null;
	}

	if (schema.authoring?.flowCapability) {
		return schema.authoring.flowCapability;
	}

	if (
		schema.content === "table" ||
		schema.content === "subdocument" ||
		schema.fieldEditor === "table" ||
		schema.fieldEditor === "subdocument"
	) {
		return "flow-delegated";
	}

	if (schema.content === "inline") {
		return "flow-inline";
	}

	if (schema.fieldEditor === "none" || schema.content === "none") {
		return "flow-structural";
	}

	return "flow-delegated";
}

export function getBlockSelectionRoleFromSchema(
	schema: BlockSchemaCapabilityLike,
): BlockSelectionRole | null {
	if (!schema) {
		return null;
	}

	if (schema.authoring?.selectionRole) {
		return schema.authoring.selectionRole;
	}

	if (schema.fieldEditor === "none") {
		return "structural";
	}

	if (schema.content === "inline") {
		return "editable-inline";
	}

	return "delegated";
}

/**
 * Reads `authoring.contentRole` from a resolved block schema.
 *
 * Unset schemas default to `"content"` so only an explicit `"chrome"`
 * declaration is furniture. Missing schemas return `null`.
 *
 * @param schema - Resolved block schema, or `null`/`undefined` when the type
 *   is unregistered.
 * @returns The content role, or `null` when `schema` is missing.
 * @throws Never.
 */
export function getBlockContentRole(
	schema: BlockSchemaCapabilityLike,
): BlockContentRole | null {
	if (!schema) {
		return null;
	}

	if (schema.authoring?.contentRole) {
		return schema.authoring.contentRole;
	}

	return "content";
}

type LegacyBlockType =
	"codeBlock" | "divider" | "image" | "subdocument" | "table";

function isLegacyBlockType(value: string): value is LegacyBlockType {
	return (
		value === "codeBlock" ||
		value === "divider" ||
		value === "image" ||
		value === "subdocument" ||
		value === "table"
	);
}

export function getFlowCapabilityFromType(
	blockType: string | null | undefined,
): FlowBlockCapability | null {
	if (!blockType) {
		return null;
	}

	if (!isLegacyBlockType(blockType)) {
		return null;
	}

	switch (blockType) {
		case "codeBlock":
			return "flow-inline";
		case "subdocument":
		case "table":
			return "flow-delegated";
		case "divider":
		case "image":
			return "flow-structural";
		default: {
			const _exhaustive: never = blockType;
			return _exhaustive;
		}
	}
}

export function shouldForceBlockScopedSelectAll(
	documentProfile: DocumentProfile,
	capability: FlowBlockCapability | null,
): boolean {
	return (
		documentProfile === "flow" &&
		(capability === "flow-structural" || capability === "flow-disallowed")
	);
}

export function isContinuousTextFlowCapability(
	capability: FlowBlockCapability | null,
): boolean {
	return capability === "flow-inline";
}

export function shouldAllowFlowInsertionInSlashMenu(
	documentProfile: DocumentProfile,
	capability: FlowBlockCapability | null,
): boolean {
	if (documentProfile !== "flow") {
		return true;
	}

	return capability !== "flow-disallowed";
}

export function shouldShowBlockInDefaultMenus(
	documentProfile: DocumentProfile,
	schema: BlockSchemaCapabilityLike,
): boolean {
	// Authoring visibility helper for user-facing insertion surfaces such as
	// slash menus and default toolbar block pickers. This is intentionally
	// narrower than document serialization: hidden/system blocks may still exist
	// in a document and should still export if present.
	if (!schema) {
		return false;
	}

	if (schema.display?.hidden) {
		return false;
	}

	if (
		schema.content === "subdocument" ||
		schema.fieldEditor === "subdocument"
	) {
		return false;
	}

	return shouldAllowFlowInsertionInSlashMenu(
		documentProfile,
		getFlowCapabilityFromSchema(schema),
	);
}

export function shouldExposeBlockInTooling(
	documentProfile: DocumentProfile,
	schema: BlockSchemaCapabilityLike,
): boolean {
	// Authoring visibility helper for programmatic write surfaces. Tooling should
	// only offer block types that are valid insertion targets for the active
	// documentProfile; this does not mean existing document content is invalid to
	// export or preserve.
	if (!schema) {
		return false;
	}

	if (schema.display?.hidden) {
		return false;
	}

	return shouldAllowFlowInsertionInSlashMenu(
		documentProfile,
		getFlowCapabilityFromSchema(schema),
	);
}

export function shouldAllowDirectBlockPaste(
	documentProfile: DocumentProfile,
	capability: FlowBlockCapability | null,
): boolean {
	// Fast-path block payload acceptance for direct paste authoring. Unknown or
	// flow-disallowed blocks must fall back to importer/normalization paths
	// rather than being treated as safe insertion surfaces.
	if (documentProfile !== "flow") {
		return true;
	}

	return capability !== null && capability !== "flow-disallowed";
}

export function getBlockSelectionRoleFromType(
	blockType: string | null | undefined,
): BlockSelectionRole {
	if (!blockType) {
		return "editable-inline";
	}

	if (!isLegacyBlockType(blockType)) {
		return "editable-inline";
	}

	switch (blockType) {
		case "divider":
		case "image":
			return "structural";
		case "codeBlock":
		case "subdocument":
		case "table":
			return "delegated";
		default: {
			const _exhaustive: never = blockType;
			return _exhaustive;
		}
	}
}

export function resolveBlockFlowCapability(
	registry: SchemaRegistry,
	blockType: string | null | undefined,
): FlowBlockCapability | null {
	if (!blockType) {
		return null;
	}

	return (
		getFlowCapabilityFromSchema(registry.resolve(blockType)) ??
		getFlowCapabilityFromType(blockType)
	);
}

type ImportNormalizationEditor = {
	documentProfile: Editor["documentProfile"];
	internals: {
		emit: Editor["internals"]["emit"];
	};
};

export interface PendingBlockProfilePolicyViolation {
	readonly blockType: string;
	readonly documentProfile: DocumentProfile;
	readonly capability: FlowBlockCapability;
	readonly reason: "flow-disallowed-block";
}

export interface PendingBlockImportPolicyViolation {
	readonly blockType: string;
	readonly documentProfile: DocumentProfile;
	readonly capability: FlowBlockCapability | null;
	readonly reason: "flow-disallowed-block" | "unknown-block-type";
}

export function createImportResult(
	parsedTopLevelBlockCount: number,
	importedTopLevelBlockCount: number,
	violations: readonly Pick<PendingBlockImportPolicyViolation, "blockType">[],
): ImportResult {
	return {
		parsedTopLevelBlockCount,
		importedTopLevelBlockCount,
		droppedBlockCount: Math.max(
			0,
			parsedTopLevelBlockCount - importedTopLevelBlockCount,
		),
		droppedBlockTypes: [
			...new Set(violations.map((violation) => violation.blockType)),
		],
		normalized: violations.length > 0,
	};
}

export function normalizePendingBlocksForImport(
	blocks: readonly PendingBlock[],
	documentProfile: DocumentProfile,
	registry: SchemaRegistry,
): {
	readonly blocks: PendingBlock[];
	readonly violations: PendingBlockImportPolicyViolation[];
} {
	const allowedBlocks: PendingBlock[] = [];
	const violations: PendingBlockImportPolicyViolation[] = [];

	for (const block of blocks) {
		if (isInternalImportedBlockType(block.type)) {
			const childResult = block.children
				? normalizePendingBlocksForImport(
						block.children,
						documentProfile,
						registry,
					)
				: null;
			if (childResult) {
				violations.push(...childResult.violations);
			}
			allowedBlocks.push(
				childResult
					? { ...block, children: childResult.blocks }
					: block,
			);
			continue;
		}

		const schema = registry.resolve(block.type);
		if (!schema) {
			violations.push({
				blockType: block.type,
				documentProfile,
				capability: null,
				reason: "unknown-block-type",
			});
			continue;
		}

		const capability = getFlowCapabilityFromSchema(schema);
		if (documentProfile === "flow" && capability === "flow-disallowed") {
			violations.push({
				blockType: block.type,
				documentProfile,
				capability,
				reason: "flow-disallowed-block",
			});
			continue;
		}

		const childResult = block.children
			? normalizePendingBlocksForImport(
					block.children,
					documentProfile,
					registry,
				)
			: null;
		if (childResult) {
			violations.push(...childResult.violations);
		}

		allowedBlocks.push(
			childResult ? { ...block, children: childResult.blocks } : block,
		);
	}

	return {
		blocks: allowedBlocks,
		violations,
	};
}

export function reportPendingBlockProfileViolations(
	editor: ImportNormalizationEditor,
	violations: readonly PendingBlockProfilePolicyViolation[],
	surface: string,
): void {
	if (violations.length === 0) {
		return;
	}

	const droppedBlockTypes = [
		...new Set(violations.map((violation) => violation.blockType)),
	];
	editor.internals.emit("diagnostic", {
		code: "PEN_PROFILE_002",
		level: "warn",
		source: "profile-policy",
		message:
			`profile-policy: dropped ${violations.length} imported block` +
			`${violations.length === 1 ? "" : "s"} during ${surface} normalization in ` +
			`${violations[0]!.documentProfile} documents`,
		remediation:
			"Import content supported by the active documentProfile or change the " +
			"documentProfile before importing structured content.",
		documentProfile: violations[0]!.documentProfile,
		droppedBlockTypes,
		surface,
		violations,
	});
}

export function filterPendingBlocksForDocumentProfile(
	blocks: readonly PendingBlock[],
	documentProfile: DocumentProfile,
	registry: SchemaRegistry,
): {
	readonly blocks: PendingBlock[];
	readonly violations: PendingBlockProfilePolicyViolation[];
} {
	if (documentProfile !== "flow") {
		return {
			blocks: [...blocks],
			violations: [],
		};
	}

	const allowedBlocks: PendingBlock[] = [];
	const violations: PendingBlockProfilePolicyViolation[] = [];

	for (const block of blocks) {
		const childResult = block.children
			? filterPendingBlocksForDocumentProfile(
					block.children,
					documentProfile,
					registry,
				)
			: null;

		if (childResult) {
			violations.push(...childResult.violations);
		}

		if (isInternalImportedBlockType(block.type)) {
			allowedBlocks.push(
				childResult
					? { ...block, children: childResult.blocks }
					: block,
			);
			continue;
		}

		const capability = resolveBlockFlowCapability(registry, block.type);
		if (capability === "flow-disallowed") {
			violations.push({
				blockType: block.type,
				documentProfile,
				capability,
				reason: "flow-disallowed-block",
			});
			continue;
		}

		allowedBlocks.push(
			childResult ? { ...block, children: childResult.blocks } : block,
		);
	}

	return {
		blocks: allowedBlocks,
		violations,
	};
}

export function reportPendingBlockImportViolations(
	editor: ImportNormalizationEditor,
	violations: readonly PendingBlockImportPolicyViolation[],
	surface: string,
): void {
	if (violations.length === 0) {
		return;
	}

	const flowViolations = violations.filter(
		(violation): violation is PendingBlockProfilePolicyViolation =>
			violation.reason === "flow-disallowed-block" &&
			violation.capability === "flow-disallowed",
	);
	if (flowViolations.length > 0) {
		reportPendingBlockProfileViolations(editor, flowViolations, surface);
	}

	const unknownViolations = violations.filter(
		(violation) => violation.reason === "unknown-block-type",
	);
	if (unknownViolations.length === 0) {
		return;
	}

	const droppedBlockTypes = [
		...new Set(unknownViolations.map((violation) => violation.blockType)),
	];
	editor.internals.emit("diagnostic", {
		code: "PEN_IMPORT_001",
		level: "warn",
		source: "import-normalization",
		message:
			`import-normalization: dropped ${unknownViolations.length} imported block` +
			`${unknownViolations.length === 1 ? "" : "s"} during ${surface} normalization ` +
			"because their block types are not registered in the active schema",
		remediation:
			"Register the required block schemas/extensions before importing this " +
			"content, or transform unsupported blocks into supported types.",
		documentProfile: editor.documentProfile,
		droppedBlockTypes,
		surface,
		violations: unknownViolations,
	});
}

function isInternalImportedBlockType(blockType: string): boolean {
	return blockType.startsWith("__table");
}

export interface ProfilePolicyViolation {
	readonly op: InsertBlockOp | SetPropsOp;
	readonly blockType: string;
	readonly documentProfile: DocumentProfile;
	readonly capability: FlowBlockCapability;
	readonly reason: "flow-disallowed-block";
}

function getProfileControlledBlockType(op: DocumentOp): string | null {
	switch (op.type) {
		case "insert-block":
			return op.blockType;
		case "set-props":
			return typeof op.props.type === "string" ? op.props.type : null;
		case "splice-text":
		case "format-text":
		case "delete-block":
		case "move-block":
		case "set-meta":
		case "grid":
		case "app":
		case "stream-open":
			return null;
		default: {
			const _exhaustive: never = op;
			void _exhaustive;
			return null;
		}
	}
}

function isProfileControlledOp(
	op: DocumentOp,
): op is InsertBlockOp | SetPropsOp {
	return (
		op.type === "insert-block" ||
		(op.type === "set-props" && typeof op.props.type === "string")
	);
}

export function filterOpsForDocumentProfile(
	ops: readonly DocumentOp[],
	documentProfile: DocumentProfile,
	registry: SchemaRegistry,
): {
	readonly ops: DocumentOp[];
	readonly violations: ProfilePolicyViolation[];
} {
	if (documentProfile !== "flow") {
		return {
			ops: [...ops],
			violations: [],
		};
	}

	const allowedOps: DocumentOp[] = [];
	const violations: ProfilePolicyViolation[] = [];

	for (const op of ops) {
		if (!isProfileControlledOp(op)) {
			allowedOps.push(op);
			continue;
		}

		const blockType = getProfileControlledBlockType(op);
		const capability = resolveBlockFlowCapability(registry, blockType);

		if (capability === "flow-disallowed" && blockType) {
			violations.push({
				op,
				blockType,
				documentProfile,
				capability,
				reason: "flow-disallowed-block",
			});
			continue;
		}

		allowedOps.push(op);
	}

	return {
		ops: allowedOps,
		violations,
	};
}
