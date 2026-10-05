import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/html.ts",
    "src/markdown.ts",
    "src/json.ts",
    "src/xml.ts",
  ],
  format: ["esm", "cjs"],
  dts: { compilerOptions: { stripInternal: true, ignoreDeprecations: "6.0" } },
  outDir: "dist",
  clean: true,
  external: [
    "@input/pen-core",
    "@input/pen-ingest",
    "@input/pen-markdown",
    "@input/pen-types",
    "domhandler",
    "htmlparser2",
    "isomorphic-dompurify",
  ],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
});
