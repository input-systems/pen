import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Inlines yjs + lib0 into a second ESM file. Node then evaluates a distinct
// module instance — the case pnpm's content-addressed store will not produce
// from an npm: alias of the same version. Written beside the fixture under
// .generated/ so Vite can load it; tmpdir sits outside the workspace
// allowlist.

const require = createRequire(import.meta.url);
const outFile = join(
  dirname(fileURLToPath(import.meta.url)),
  ".generated",
  "yjs-copy.mjs",
);

mkdirSync(dirname(outFile), { recursive: true });

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
