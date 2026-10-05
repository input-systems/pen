import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "@input/pen-core";
import type {
	AssetProvider,
	AssetRef,
	DiagnosticEvent,
	Editor,
} from "@input/pen-types";
import { uploadImageFiles } from "../transferImages";
import { defaultSchema } from "@input/pen-schema";

const editors: Editor[] = [];

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

/** An editor without default extensions, recording its diagnostics. */
function diagnosingEditor() {
	const editor = createEditor({
		schema: defaultSchema,
		preset: { resolve: () => ({ extensions: [] }) },
	});
	editors.push(editor);
	const diagnostics: DiagnosticEvent[] = [];
	editor.on("diagnostic", (event) => {
		diagnostics.push(event);
	});
	return { editor, diagnostics };
}

function imageFile(name: string, size: number): File {
	return new File([new Uint8Array(size)], name, { type: "image/png" });
}

function stubProvider(overrides: Partial<AssetProvider> = {}) {
	const upload = vi.fn(
		overrides.upload ??
			(async (
				file: File | Blob,
				options?: { onProgress?: (n: number) => void },
			) => {
				options?.onProgress?.(1);
				const ref: AssetRef = {
					id: "asset-1",
					url: "memory://uploaded.png",
					mimeType: "image/png",
					size: file.size,
				};
				return ref;
			}),
	);
	const provider: AssetProvider = {
		resolve(ref) {
			return ref.url;
		},
		async delete() {},
		...overrides,
		upload,
	};
	return { provider, upload };
}

describe("IOP4 asset upload lifecycle", () => {
	it("IOP4 API10 rejects oversize uploads with a diagnostic naming the limit and actual size", async () => {
		const { editor, diagnostics } = diagnosingEditor();
		const { provider, upload } = stubProvider({ maxSize: 8 });
		const file = imageFile("big.png", 16);

		const uploaded = await uploadImageFiles([file], provider, { editor });

		expect(uploaded).toEqual([]);
		expect(upload).not.toHaveBeenCalled();
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			code: "asset-upload-failed",
			level: "error",
			reason: "oversize",
			fileName: "big.png",
			size: 16,
			maxSize: 8,
		});
		expect(diagnostics[0]?.message).toContain("8");
		expect(diagnostics[0]?.message).toContain("16");
	});

	it("IOP4 API10 reports provider failure with a diagnostic and inserts no block", async () => {
		const { editor, diagnostics } = diagnosingEditor();
		const { provider } = stubProvider({
			upload: vi.fn().mockRejectedValue(new Error("storage down")),
		});
		const file = imageFile("shot.png", 4);

		const uploaded = await uploadImageFiles([file], provider, { editor });

		expect(uploaded).toEqual([]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			code: "asset-upload-failed",
			level: "error",
			reason: "provider",
			fileName: "shot.png",
			size: 4,
		});
		expect(diagnostics[0]?.message).toContain("storage down");
		expect(diagnostics[0]?.message).toContain("shot.png");
	});

	it("IOP4 API10 successful upload is unchanged and observes onProgress during upload", async () => {
		const progress: number[] = [];
		const { provider, upload } = stubProvider();
		const file = imageFile("ok.png", 4);

		const uploaded = await uploadImageFiles([file], provider, {
			onProgress: (value) => {
				progress.push(value);
			},
		});

		expect(uploaded).toEqual([{ src: "memory://uploaded.png", alt: "ok" }]);
		expect(upload).toHaveBeenCalledWith(
			file,
			expect.objectContaining({
				mimeType: "image/png",
				onProgress: expect.any(Function),
			}),
		);
		expect(progress).toEqual([1]);
	});

	it("IOP4 inserts successful files in a mixed batch and never calls delete", async () => {
		const { editor, diagnostics } = diagnosingEditor();
		const deleteFn = vi.fn();
		const { provider } = stubProvider({
			maxSize: 8,
			delete: deleteFn,
			upload: vi.fn(async (file: File) => {
				if (file.name === "fail.png") {
					throw new Error("denied");
				}
				return {
					id: "ok",
					url: "memory://ok.png",
					mimeType: "image/png",
					size: file.size,
				};
			}),
		});

		const uploaded = await uploadImageFiles(
			[
				imageFile("ok.png", 4),
				imageFile("big.png", 32),
				imageFile("fail.png", 4),
			],
			provider,
			{ editor },
		);

		expect(uploaded).toEqual([{ src: "memory://ok.png", alt: "ok" }]);
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.map((event) => event.reason)).toEqual([
			"oversize",
			"provider",
		]);
		expect(deleteFn).not.toHaveBeenCalled();
	});
});
