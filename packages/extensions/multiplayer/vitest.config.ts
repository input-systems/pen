import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const yjsSource = (file: string) =>
	fileURLToPath(new URL(`../../crdt/yjs/src/${file}`, import.meta.url));

export default defineConfig({
	resolve: {
		// The subpath comes first: vite matches `find` or `find + "/"` in
		// insertion order, so the bare entry would swallow it.
		alias: {
			"@input/pen-yjs/awareness": yjsSource("awareness.ts"),
			"@input/pen-yjs": yjsSource("index.ts"),
		},
	},
});
