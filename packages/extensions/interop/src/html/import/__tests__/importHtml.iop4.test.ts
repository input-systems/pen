import { describe, expect, it, vi, afterEach } from "vitest";
import {
	assetProviderFacet,
	createEditor,
	defineExtension,
} from "@input/pen-core";
import type { AssetProvider, DiagnosticEvent } from "@input/pen-types";
import { htmlImporter } from "../importer";
import {
	defaultRegistry,
	noDefaultExtensionsPreset,
} from "./importHtml.testHelpers";

function editorWithProvider(provider?: AssetProvider) {
	return createEditor({
		schema: defaultRegistry,
		preset: noDefaultExtensionsPreset,
		extensions: provider
			? [
					defineExtension({
						name: "test-assets",
						facets: [assetProviderFacet.of(provider)],
					}),
				]
			: [],
	});
}

function stubProvider(overrides: Partial<AssetProvider> = {}) {
	const upload = vi.fn(
		overrides.upload ??
			(async (file: File | Blob) => ({
				id: "ingested",
				url: "memory://ingested.png",
				mimeType: "image/png",
				size: file.size,
			})),
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

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("IOP4 HTML img src policy", () => {
	it("IOP4 keep setting leaves remote img src unchanged and does not call the provider", async () => {
		const { provider, upload } = stubProvider();
		const editor = editorWithProvider(provider);
		const remote = "https://cdn.example/keep.png";

		await htmlImporter.import(
			`<img src="${remote}" alt="remote" />`,
			editor,
			{ imageSrc: "keep" },
		);

		const images = [...editor.blocks("image")];
		expect(images).toHaveLength(1);
		expect(images[0]?.props.src).toBe(remote);
		expect(upload).not.toHaveBeenCalled();
		editor.destroy();
	});

	it("IOP4 default import keeps remote img src (no ingest)", async () => {
		const { provider, upload } = stubProvider();
		const editor = editorWithProvider(provider);
		const remote = "https://cdn.example/default.png";

		await htmlImporter.import(`<img src="${remote}" alt="remote" />`, editor);

		const images = [...editor.blocks("image")];
		expect(images).toHaveLength(1);
		expect(images[0]?.props.src).toBe(remote);
		expect(upload).not.toHaveBeenCalled();
		editor.destroy();
	});

	it("IOP4 API10 ingest setting routes remote img src through the asset provider", async () => {
		const { provider, upload } = stubProvider();
		const editor = editorWithProvider(provider);
		const remote = "https://cdn.example/ingest.png";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { "content-type": "image/png" },
				}),
			),
		);

		await htmlImporter.import(
			`<img src="${remote}" alt="remote" />`,
			editor,
			{ imageSrc: "ingest" },
		);

		expect(fetch).toHaveBeenCalledWith(remote);
		expect(upload).toHaveBeenCalledTimes(1);
		const images = [...editor.blocks("image")];
		expect(images).toHaveLength(1);
		expect(images[0]?.props.src).toBe("memory://ingested.png");
		editor.destroy();
	});

	it("IOP4 API10 ingest oversize emits asset-upload-failed naming the limit and actual size", async () => {
		const { provider, upload } = stubProvider({ maxSize: 2 });
		const editor = editorWithProvider(provider);
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { "content-type": "image/png" },
				}),
			),
		);

		await htmlImporter.import(
			'<img src="https://cdn.example/big.png" alt="remote" />',
			editor,
			{ imageSrc: "ingest" },
		);

		expect(upload).not.toHaveBeenCalled();
		expect([...editor.blocks("image")]).toHaveLength(0);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			code: "asset-upload-failed",
			reason: "oversize",
			size: 4,
			maxSize: 2,
		});
		expect(diagnostics[0]?.message).toContain("4");
		expect(diagnostics[0]?.message).toContain("2");
		editor.destroy();
	});

	it("IOP4 API10 ingest failure emits asset-upload-failed and inserts no image block", async () => {
		const { provider } = stubProvider({
			upload: vi.fn().mockRejectedValue(new Error("cdn denied")),
		});
		const editor = editorWithProvider(provider);
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { "content-type": "image/png" },
				}),
			),
		);

		await htmlImporter.import(
			'<img src="https://cdn.example/fail.png" alt="remote" />',
			editor,
			{ imageSrc: "ingest" },
		);

		expect([...editor.blocks("image")]).toHaveLength(0);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			code: "asset-upload-failed",
			level: "error",
			source: "import-html",
			reason: "provider",
			size: 4,
		});
		expect(diagnostics[0]?.message).toContain("cdn denied");
		expect(diagnostics[0]?.message).toContain("4");
		editor.destroy();
	});

	it("IOP4 API10 ingest forwards onProgress to the provider", async () => {
		const progress: number[] = [];
		const { provider, upload } = stubProvider();
		const editor = editorWithProvider(provider);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { "content-type": "image/png" },
				}),
			),
		);

		await htmlImporter.import(
			'<img src="https://cdn.example/progress.png" alt="remote" />',
			editor,
			{
				imageSrc: "ingest",
				onProgress: (value) => {
					progress.push(value);
				},
			},
		);

		expect(upload).toHaveBeenCalledTimes(1);
		expect(upload.mock.calls[0]?.[1]).toEqual(
			expect.objectContaining({
				onProgress: expect.any(Function),
			}),
		);
		upload.mock.calls[0]?.[1]?.onProgress?.(0.5);
		expect(progress).toEqual([0.5]);
		editor.destroy();
	});

	it("IOP4 ingest mid-transfer failure emits asset-upload-failed and inserts no image", async () => {
		const { provider } = stubProvider({
			upload: vi.fn(async (_file, options) => {
				options?.onProgress?.(0);
				throw new Error("socket reset");
			}),
		});
		const editor = editorWithProvider(provider);
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { "content-type": "image/png" },
				}),
			),
		);

		await htmlImporter.import(
			'<img src="https://cdn.example/mid.png" alt="remote" />',
			editor,
			{ imageSrc: "ingest" },
		);

		expect([...editor.blocks("image")]).toHaveLength(0);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "asset-upload-failed",
				reason: "provider",
				message: expect.stringContaining("socket reset"),
			}),
		]);
		editor.destroy();
	});

	it("IOP4 ingest drops a hostile URL the provider returned", async () => {
		const { provider, upload } = stubProvider({
			upload: vi.fn(async (file: File | Blob) => ({
				id: "hostile",
				url: "javascript:alert(1)",
				mimeType: "image/png",
				size: file.size,
			})),
			resolve(ref) {
				return ref.url;
			},
		});
		const editor = editorWithProvider(provider);
		const diagnostics: DiagnosticEvent[] = [];
		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { "content-type": "image/png" },
				}),
			),
		);

		await htmlImporter.import(
			'<img src="https://cdn.example/ok.png" alt="remote" />',
			editor,
			{ imageSrc: "ingest" },
		);

		expect(upload).toHaveBeenCalledTimes(1);
		expect([...editor.blocks("image")]).toHaveLength(0);
		expect(diagnostics).toEqual([
			expect.objectContaining({
				code: "asset-upload-failed",
				reason: "provider",
				message: expect.stringContaining("blocked URL"),
			}),
		]);
		editor.destroy();
	});
});
