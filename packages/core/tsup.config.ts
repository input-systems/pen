import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: { compilerOptions: { stripInternal: true, ignoreDeprecations: "6.0" } },
	outDir: "dist",
	clean: true,
	external: [
		"@input/pen-ingest",
		"@input/pen-types",
		"@input/pen-yjs",
		"@input/pen-undo",
		"@input/pen-tools",
		"@input/pen-ai",
		"@input/pen-markdown",
	],
	outExtension({ format }) {
		return { js: format === "esm" ? ".mjs" : ".cjs" };
	},
});
