import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as Y from "yjs";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

export async function loadDuplicateYjs(): Promise<{
	Doc: typeof Y.Doc;
	/** The whole second yjs module, for tests that drive its applyUpdate. */
	module: typeof Y;
}> {
	const result = spawnSync(
		process.execPath,
		[join(fixtureDir, "build.mjs")],
		{
			encoding: "utf8",
		},
	);
	if (result.status !== 0) {
		throw new Error(
			`failed to build yjs-duplicate fixture:\n${result.stderr}\n${result.stdout}`,
		);
	}

	const outFile = result.stdout.trim();
	if (!outFile) {
		throw new Error("yjs-duplicate fixture build printed no output path");
	}
	const duplicate = (await import(pathToFileURL(outFile).href)) as typeof Y;
	if (typeof duplicate.Doc !== "function") {
		throw new Error("yjs-duplicate bundle did not export Doc");
	}

	// If these constructors are identical, the bundle resolved to the same
	// module as `import "yjs"` and this is not a two-copy fixture.
	if (duplicate.Doc === Y.Doc) {
		throw new Error(
			"yjs-duplicate fixture loaded the same Doc constructor as yjs",
		);
	}

	return { Doc: duplicate.Doc, module: duplicate };
}
