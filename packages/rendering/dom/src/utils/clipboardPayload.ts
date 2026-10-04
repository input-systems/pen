import {
	PEN_CLIPBOARD_JSON_MIME,
	PEN_CLIPBOARD_JSON_MIME_LEGACY,
	PEN_CLIPBOARD_PAYLOAD_VERSION,
	type DiagnosticEvent,
	type PenClipboardBlock,
	type PenClipboardDelta,
	type PenClipboardPayload,
} from "@input/pen-types";

export {
	PEN_CLIPBOARD_JSON_MIME,
	PEN_CLIPBOARD_JSON_MIME_LEGACY,
	PEN_CLIPBOARD_PAYLOAD_VERSION,
};
export type { PenClipboardPayload };

export type Delta = PenClipboardDelta;
export type PenBlock = PenClipboardBlock;

export type PenClipboardFallbackFlavor = "html" | "plain-text";

export type PenClipboardReadResult =
	| {
			status: "ok";
			payload: PenClipboardPayload;
			forbiddenKeyCount: number;
			migratedFrom?: number;
	  }
	| {
			status: "fallback";
			flavor: PenClipboardFallbackFlavor;
			diagnostic: DiagnosticEvent;
	  };

/**
 * Thrown by `decodePenBlocksFromHtml` when the embedded Pen payload cannot be
 * used and paste must fall back to another clipboard flavor. Carries the
 * diagnostic to emit and the flavor to fall back to.
 */
export class PenClipboardFallbackError extends Error {
	readonly diagnostic: DiagnosticEvent;
	readonly flavor: PenClipboardFallbackFlavor;

	constructor(
		diagnostic: DiagnosticEvent,
		flavor: PenClipboardFallbackFlavor,
	) {
		super(diagnostic.message);
		this.name = "PenClipboardFallbackError";
		this.diagnostic = diagnostic;
		this.flavor = flavor;
	}
}

export function createPenClipboardPayload(
	blocks: readonly PenBlock[],
): PenClipboardPayload {
	return {
		version: PEN_CLIPBOARD_PAYLOAD_VERSION,
		blockTypes: collectBlockTypes(blocks),
		blocks,
	};
}

export function serializePenClipboardPayload(
	blocks: readonly PenBlock[],
): string {
	return JSON.stringify(createPenClipboardPayload(blocks));
}

export function readPenClipboardJson(dataTransfer: DataTransfer): string {
	return (
		dataTransfer.getData(PEN_CLIPBOARD_JSON_MIME) ||
		dataTransfer.getData(PEN_CLIPBOARD_JSON_MIME_LEGACY)
	);
}

export function parsePenClipboardPayload(raw: unknown): PenClipboardReadResult {
	const value = typeof raw === "string" ? parseJsonValue(raw) : raw;
	if (value === undefined) {
		return clipboardFallback(
			"clipboard-invalid-payload",
			"Pen clipboard payload is not valid JSON; falling back to HTML.",
		);
	}

	if (Array.isArray(value)) {
		return migrateUnversionedBlocks(value);
	}

	if (!isPlainObject(value)) {
		return clipboardFallback(
			"clipboard-invalid-payload",
			"Pen clipboard payload is not a versioned envelope; falling back to HTML.",
		);
	}

	if (!Object.prototype.hasOwnProperty.call(value, "version")) {
		if (!Array.isArray(value.blocks)) {
			return clipboardFallback(
				"clipboard-invalid-payload",
				"Pen clipboard payload is missing version and blocks; falling back to HTML.",
			);
		}
		return migrateUnversionedBlocks(value.blocks);
	}

	if (typeof value.version !== "number" || !Number.isInteger(value.version)) {
		return clipboardFallback(
			"clipboard-unknown-version",
			"Pen clipboard payload version is not an integer; falling back to HTML.",
			{ payloadVersion: value.version },
		);
	}

	if (value.version > PEN_CLIPBOARD_PAYLOAD_VERSION) {
		return clipboardFallback(
			"clipboard-unknown-version",
			`Pen clipboard payload version ${value.version} is newer than this reader (${PEN_CLIPBOARD_PAYLOAD_VERSION}); falling back to HTML.`,
			{ payloadVersion: value.version },
		);
	}

	if (!Array.isArray(value.blocks)) {
		return clipboardFallback(
			"clipboard-invalid-payload",
			"Pen clipboard payload is missing a blocks array; falling back to HTML.",
			{ payloadVersion: value.version },
		);
	}

	const sanitized = sanitizeClipboardBlocks(value.blocks);
	const payload = createPenClipboardPayload(sanitized.blocks);
	if (value.version === PEN_CLIPBOARD_PAYLOAD_VERSION) {
		return {
			status: "ok",
			payload,
			forbiddenKeyCount: sanitized.forbiddenKeyCount,
		};
	}

	return {
		status: "ok",
		payload,
		forbiddenKeyCount: sanitized.forbiddenKeyCount,
		migratedFrom: value.version,
	};
}

export function encodePenBlocksForHtml(penBlocksJson: string): string {
	return bytesToBase64(
		new TextEncoder().encode(ensureClipboardJson(penBlocksJson)),
	);
}

export function decodePenBlocksFromHtml(encoded: string): PenBlock[] {
	const json = new TextDecoder().decode(base64ToBytes(encoded));
	const result = parsePenClipboardPayload(json);
	if (result.status === "fallback") {
		throw new PenClipboardFallbackError(result.diagnostic, result.flavor);
	}
	return [...result.payload.blocks];
}

function ensureClipboardJson(penBlocksJson: string): string {
	const result = parsePenClipboardPayload(penBlocksJson);
	if (result.status === "ok") {
		return JSON.stringify(result.payload);
	}
	return penBlocksJson;
}

function migrateUnversionedBlocks(blocks: unknown[]): PenClipboardReadResult {
	const sanitized = sanitizeClipboardBlocks(blocks);
	return {
		status: "ok",
		payload: createPenClipboardPayload(sanitized.blocks),
		forbiddenKeyCount: sanitized.forbiddenKeyCount,
		migratedFrom: 0,
	};
}

const REJECTED_OWN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function sanitizeClipboardBlocks(blocks: unknown[]): {
	blocks: PenBlock[];
	forbiddenKeyCount: number;
} {
	const forbiddenKeyCount = { n: 0 };
	return {
		blocks: sanitizeIngestedJson(blocks, forbiddenKeyCount) as PenBlock[],
		forbiddenKeyCount: forbiddenKeyCount.n,
	};
}

function sanitizeIngestedJson(
	value: unknown,
	forbiddenKeyCount: { n: number },
): unknown {
	if (Array.isArray(value)) {
		return value.map((item) =>
			sanitizeIngestedJson(item, forbiddenKeyCount),
		);
	}
	if (!isPlainObject(value)) {
		return value;
	}
	const clean = Object.create(null) as Record<string, unknown>;
	for (const key of Object.keys(value)) {
		if (REJECTED_OWN_KEYS.has(key)) {
			forbiddenKeyCount.n += 1;
			continue;
		}
		clean[key] = sanitizeIngestedJson(value[key], forbiddenKeyCount);
	}
	return clean;
}

function collectBlockTypes(blocks: readonly PenBlock[]): string[] {
	const types = new Set<string>();
	const visit = (block: PenBlock | { type?: string; children?: unknown }) => {
		if (typeof block.type === "string" && block.type.length > 0) {
			types.add(block.type);
		}
		if (!Array.isArray(block.children)) {
			return;
		}
		for (const child of block.children) {
			if (child && typeof child === "object") {
				visit(child as PenBlock);
			}
		}
	};
	for (const block of blocks) {
		visit(block);
	}
	return [...types].sort();
}

function clipboardFallback(
	code: string,
	message: string,
	extra?: Record<string, unknown>,
): PenClipboardReadResult {
	return {
		status: "fallback",
		flavor: "html",
		diagnostic: {
			code,
			level: "warn",
			source: "clipboard",
			message,
			remediation:
				"Use the HTML or plain-text clipboard flavor; do not read the JSON blocks.",
			...extra,
		},
	};
}

function parseJsonValue(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		// clipboard json flavor was unreadable.
		return undefined;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array): string {
	const binary = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(
		"",
	);
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	return Uint8Array.from(binary, (value) => value.codePointAt(0) ?? 0);
}
