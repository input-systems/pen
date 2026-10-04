import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Inlines yjs + lib0 into a second ESM file. Node then evaluates a distinct
// module instance — the case pnpm's content-addressed store will not produce
// from an npm: alias of the same version. Written to a fresh OS temp dir so
// running the tests never touches the working tree.

const require = createRequire(import.meta.url);
const outFile = join(
	mkdtempSync(join(tmpdir(), "pen-yjs-duplicate-")),
	"yjs-copy.mjs",
);

const yjsEntry = join(
	dirname(require.resolve("yjs/package.json")),
	"dist",
	"yjs.mjs",
);

let esbuild;
try {
	esbuild = createRequire(require.resolve("tsup/package.json"))("esbuild");
} catch (error) {
	throw new Error(
		"yjs-duplicate fixture needs esbuild via this package's tsup devDependency",
		{ cause: error },
	);
}

await esbuild.build({
	entryPoints: [yjsEntry],
	bundle: true,
	format: "esm",
	outfile: outFile,
	platform: "neutral",
	logLevel: "silent",
});

process.stdout.write(`${outFile}\n`);
