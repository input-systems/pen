import { assetProviderFacet, buildSplitBlockRecipe } from "@input/pen-core";
import type {
	AssetProvider,
	DocumentOp,
	Editor,
	Position,
} from "@input/pen-types";
import { urlPolicyFromEditor } from "../security/resolveEditorUrl";
import type { ResolvedDropTarget } from "./dropResolver";
import { IMAGE_BLOCK_TYPE, type UploadedImage } from "./transferTypes";
import { generateId } from "@input/pen-types";

const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)$/;
const PARSE_BASE = "https://pen.invalid/";

export function getAssetProvider(editor: Editor): AssetProvider | null {
	return (editor.facet(assetProviderFacet) as AssetProvider | null) ?? null;
}

export function getImageFiles(dataTransfer: DataTransfer): File[] {
	const files: File[] = [];
	for (let i = 0; i < dataTransfer.files.length; i++) {
		const file = dataTransfer.files[i];
		if (IMAGE_MIME_RE.test(file.type)) {
			files.push(file);
		}
	}
	return files;
}

function hasFileType(dataTransfer: DataTransfer): boolean {
	for (let i = 0; i < dataTransfer.types.length; i++) {
		if (dataTransfer.types[i] === "Files") return true;
	}
	return false;
}

/**
 * Whether the editor can accept an image file transfer.
 *
 * During `dragover`/`dragenter` the browser restricts `dataTransfer.files`
 * to an empty list (security sandbox). Only `dataTransfer.types` (containing
 * `"Files"`) is available. We therefore check `types` first and only fall
 * through to the actual file-list when it's populated (i.e. during `drop`).
 */
export function canAcceptImageTransfer(
	editor: Editor,
	dataTransfer: DataTransfer | null,
): boolean {
	if (!dataTransfer) return false;
	const hasFiles = hasFileType(dataTransfer) || dataTransfer.files.length > 0;
	if (!hasFiles) return false;
	if (!editor.schema.resolve(IMAGE_BLOCK_TYPE)) return false;
	return getAssetProvider(editor) !== null;
}

export interface UploadImageFilesOptions {
	editor?: Editor;
	maxSize?: number;
	onProgress?: (progress: number) => void;
}

/**
 * Upload image files through the host `AssetProvider`.
 *
 * Oversize files (against `options.maxSize` or `assetProvider.maxSize`) and
 * provider failures emit `asset-upload-failed` when `editor` is provided and
 * are omitted from the result — no image block is inserted for those files.
 * Files that succeed in the same batch are returned for insert (partial insert).
 */
export async function uploadImageFiles(
	files: File[],
	assetProvider: AssetProvider,
	options?: UploadImageFilesOptions,
): Promise<UploadedImage[]> {
	const uploaded: UploadedImage[] = [];
	const maxSize = options?.maxSize ?? assetProvider.maxSize;

	for (const file of files) {
		const fileName = file.name || "image";
		if (maxSize != null && file.size > maxSize) {
			emitAssetUploadFailed(options?.editor, {
				fileName,
				size: file.size,
				maxSize,
				reason: "oversize",
				message:
					`asset-upload-failed: "${fileName}" is ${file.size} bytes, ` +
					`exceeds maxSize ${maxSize}`,
			});
			continue;
		}

		try {
			const ref = await assetProvider.upload(file, {
				mimeType: file.type,
				...(maxSize != null ? { maxSize } : {}),
				...(options?.onProgress
					? { onProgress: options.onProgress }
					: {}),
			});

			uploaded.push({
				src: assetProvider.resolve(ref),
				alt: file.name?.replace(/\.[^.]+$/, "") ?? "",
			});
		} catch (error) {
			emitAssetUploadFailed(options?.editor, {
				fileName,
				size: file.size,
				maxSize,
				reason: "provider",
				error,
				message:
					`asset-upload-failed: "${fileName}" (${file.size} bytes): ` +
					`${errorMessage(error)}`,
			});
		}
	}

	return uploaded;
}

function emitAssetUploadFailed(
	editor: Editor | undefined,
	event: {
		fileName: string;
		size: number;
		maxSize?: number;
		reason: "oversize" | "provider";
		error?: unknown;
		message: string;
	},
): void {
	if (!editor) return;
	editor.internals.emit("diagnostic", {
		code: "asset-upload-failed",
		level: "error",
		source: "assets",
		message: event.message,
		remediation:
			event.reason === "oversize"
				? "Compress the image or raise AssetProvider.maxSize."
				: "Retry the upload or inspect the AssetProvider error.",
		fileName: event.fileName,
		size: event.size,
		maxSize: event.maxSize,
		reason: event.reason,
		error: event.error,
	});
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return String(error);
}

function parsedProtocol(raw: string): string | null {
	try {
		return new URL(raw, PARSE_BASE).protocol;
	} catch {
		// invalid url has no protocol to classify.
		return null;
	}
}

function isLiveExecutableImageSrc(raw: string): boolean {
	const protocol = parsedProtocol(raw);
	return (
		protocol === "javascript:" ||
		protocol === "vbscript:" ||
		protocol === "data:"
	);
}

// resolve first; executable / rejected data: dropped; other schemes stored raw (SEC1 render-time)
function admitTransferImageSrc(editor: Editor, raw: unknown): string | null {
	const admitted = urlPolicyFromEditor(editor).resolve(raw, "image");
	if (admitted !== null) {
		return admitted;
	}
	if (typeof raw !== "string" || isLiveExecutableImageSrc(raw)) {
		return null;
	}
	return raw;
}

function emitAssetBlockedUrl(editor: Editor, raw: unknown): void {
	const scheme =
		typeof raw === "string"
			? (parsedProtocol(raw) ?? "unparsable")
			: "non-string";
	editor.internals.emit("diagnostic", {
		code: "asset-blocked-url",
		level: "warn",
		source: "assets",
		message: `asset-blocked-url: image src scheme "${scheme}" is not admitted`,
		remediation:
			"Use an http(s) or allowed data:image URL, or customize pen.urlPolicy.",
		scheme,
	});
}

function admitUploadedImages(
	editor: Editor,
	uploaded: UploadedImage[],
): UploadedImage[] {
	const admitted: UploadedImage[] = [];
	for (const image of uploaded) {
		const src = admitTransferImageSrc(editor, image.src);
		if (src === null) {
			emitAssetBlockedUrl(editor, image.src);
			continue;
		}
		admitted.push({ src, alt: image.alt });
	}
	return admitted;
}

export function insertUploadedImages(
	editor: Editor,
	uploaded: UploadedImage[],
	position: Position,
	options?: { undoGroup?: boolean },
): {
	position: Position | null;
	lastInsertedBlockId: string | null;
} {
	const resolvedPosition = resolveValidImageInsertPosition(editor, position);
	if (!resolvedPosition) {
		return { position: null, lastInsertedBlockId: null };
	}

	const { ops, lastInsertedBlockId } = buildImageInsertOps(
		admitUploadedImages(editor, uploaded),
		resolvedPosition,
	);
	if (ops.length === 0) {
		return { position: null, lastInsertedBlockId: null };
	}

	editor.apply(ops, {
		origin: "user",
		...(options?.undoGroup === false ? {} : { undoGroup: true }),
	});
	return { position: resolvedPosition, lastInsertedBlockId };
}

export function insertUploadedImagesAtDropTarget(
	editor: Editor,
	uploaded: UploadedImage[],
	target: ResolvedDropTarget,
	options?: { undoGroup?: boolean },
): string | null {
	if (target.kind === "block-edge" || target.kind === "document-end") {
		return insertUploadedImages(editor, uploaded, target.position, options)
			.lastInsertedBlockId;
	}

	const images = admitUploadedImages(editor, uploaded);
	if (images.length === 0) {
		return null;
	}

	const point = target.point;
	const block = editor.getBlock(point.blockId);
	const schema = block ? editor.schema.resolve(block.type) : null;
	if (!block || schema?.content !== "inline") {
		return insertUploadedImages(editor, images, "last", options)
			.lastInsertedBlockId;
	}

	const textLength = block.textContent().length;
	const clampedOffset = Math.max(0, Math.min(point.offset, textLength));
	if (clampedOffset === 0 || clampedOffset >= textLength) {
		return insertUploadedImages(
			editor,
			images,
			clampedOffset === 0
				? { before: point.blockId }
				: { after: point.blockId },
			options,
		).lastInsertedBlockId;
	}

	const tailBlockId = generateId();
	const recipe = buildSplitBlockRecipe({
		block,
		offset: clampedOffset,
		newBlockId: tailBlockId,
	});
	const inserted = buildImageInsertOps(images, { before: tailBlockId });
	const lastInsertedBlockId = inserted.lastInsertedBlockId;
	if (!lastInsertedBlockId) {
		return null;
	}

	editor.apply([...recipe.ops, ...inserted.ops], {
		origin: "user",
		structural: recipe.structural,
		...(options?.undoGroup === false ? {} : { undoGroup: true }),
	});
	return lastInsertedBlockId;
}

/** After the last block, or the document end when there is none. */
export function resolveDefaultDropTarget(editor: Editor): ResolvedDropTarget {
	const lastBlock = editor.lastBlock();
	if (!lastBlock) {
		return {
			kind: "document-end",
			position: "last",
		};
	}

	return {
		kind: "block-edge",
		blockId: lastBlock.id,
		side: "after",
		position: { after: lastBlock.id },
	};
}

/** One image block per upload, the first at `position` and each next after the previous. */
function buildImageInsertOps(
	images: readonly UploadedImage[],
	position: Position,
): { ops: DocumentOp[]; lastInsertedBlockId: string | null } {
	const ops: DocumentOp[] = [];
	let lastInsertedBlockId: string | null = null;
	for (const image of images) {
		const blockId = generateId();
		ops.push({
			type: "insert-block",
			blockId,
			blockType: IMAGE_BLOCK_TYPE,
			props: {
				src: image.src,
				alt: image.alt,
			},
			position: lastInsertedBlockId
				? { after: lastInsertedBlockId }
				: position,
		});
		lastInsertedBlockId = blockId;
	}
	return { ops, lastInsertedBlockId };
}

function resolveValidImageInsertPosition(
	editor: Editor,
	position: Position,
): Position | null {
	if (position === "first" || position === "last") {
		return position;
	}

	if ("before" in position) {
		if (editor.getBlock(position.before)) {
			return position;
		}
	} else if ("after" in position) {
		if (editor.getBlock(position.after)) {
			return position;
		}
	} else if (editor.getBlock(position.parent)) {
		return position;
	}

	const lastBlock = editor.lastBlock();
	if (lastBlock) {
		return { after: lastBlock.id };
	}

	return null;
}
