import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const PEN_SOURCE_ALIASES = {
	"@input/pen-ai/autocomplete": fileURLToPath(
		new URL(
			"../../../../packages/extensions/ai/src/autocomplete.ts",
			import.meta.url,
		),
	),
	"@input/pen-ai/stream": fileURLToPath(
		new URL("../../../../packages/extensions/ai/src/stream.ts", import.meta.url),
	),
	"@input/pen-ai/suggestions": fileURLToPath(
		new URL(
			"../../../../packages/extensions/ai/src/suggestions.ts",
			import.meta.url,
		),
	),
	// keep the bare specifier below every @input/pen-ai/* key: vite matches
	// `find` or `find + "/"` in insertion order, so a root-first entry would
	// swallow the subpaths above
	"@input/pen-ai": fileURLToPath(
		new URL("../../../../packages/extensions/ai/src/index.ts", import.meta.url),
	),
	"@input/pen-core": fileURLToPath(
		new URL("../../../../packages/core/src/index.ts", import.meta.url),
	),
	// subpath before the bare specifier (see the @input/pen-ai note above)
	"@input/pen-yjs/awareness": fileURLToPath(
		new URL(
			"../../../../packages/crdt/yjs/src/awareness.ts",
			import.meta.url,
		),
	),
	"@input/pen-yjs": fileURLToPath(
		new URL("../../../../packages/crdt/yjs/src/index.ts", import.meta.url),
	),
	"@input/pen-tools": fileURLToPath(
		new URL(
			"../../../../packages/extensions/tools/src/index.ts",
			import.meta.url,
		),
	),
	"@input/pen-interop/html": fileURLToPath(
		new URL(
			"../../../../packages/extensions/interop/src/html.ts",
			import.meta.url,
		),
	),
	"@input/pen-dom": fileURLToPath(
		new URL("../../../../packages/rendering/dom/src", import.meta.url),
	),
	"@input/pen-multiplayer": fileURLToPath(
		new URL(
			"../../../../packages/extensions/multiplayer/src/index.ts",
			import.meta.url,
		),
	),
	"@input/pen": fileURLToPath(
		new URL("../../../../packages/pen/src/index.ts", import.meta.url),
	),
	"@input/pen-react": fileURLToPath(
		new URL(
			"../../../../packages/rendering/react/src/index.ts",
			import.meta.url,
		),
	),
	"@input/pen-schema": fileURLToPath(
		new URL("../../../../packages/schema/src/index.ts", import.meta.url),
	),
	"@input/pen-shortcuts": fileURLToPath(
		new URL(
			"../../../../packages/extensions/shortcuts/src/index.ts",
			import.meta.url,
		),
	),
	"@input/pen-test": fileURLToPath(
		new URL("../../../../packages/tooling/test/src/index.ts", import.meta.url),
	),
	"@input/pen-types": fileURLToPath(
		new URL("../../../../packages/types/src/index.ts", import.meta.url),
	),
	"@input/pen-undo": fileURLToPath(
		new URL("../../../../packages/extensions/undo/src/index.ts", import.meta.url),
	),
} as const;

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	plugins: [react()],
	resolve: {
		alias: PEN_SOURCE_ALIASES,
		conditions: ["import", "module", "browser", "default"],
		dedupe: ["react", "react-dom"],
	},
	server: {
		host: "127.0.0.1",
		allowedHosts: ["pen.test"],
		// do not reload Playwright pages when aliased workspace sources change
		watch: null,
		fs: {
			allow: [repoRoot],
		},
	},
	optimizeDeps: {
		exclude: Object.keys(PEN_SOURCE_ALIASES),
	},
});
