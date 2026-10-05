import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/suggestions.ts",
		"src/autocomplete.ts",
		"src/skills.ts",
		"src/tools.ts",
		"src/stream.ts",
	],
	format: ["esm", "cjs"],
	dts: { compilerOptions: { stripInternal: true, ignoreDeprecations: "6.0" } },
	outDir: "dist",
	clean: true,
	external: [
		"@input/pen-core",
		"@input/pen-ingest",
		"@input/pen-tools",
		"@input/pen-types",
	],
	outExtension({ format }) {
		return { js: format === "esm" ? ".mjs" : ".cjs" };
	},
});
