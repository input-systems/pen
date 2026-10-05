import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/direct.ts", "src/sse.ts"],
  format: ["esm", "cjs"],
  dts: { compilerOptions: { stripInternal: true, ignoreDeprecations: "6.0" } },
  outDir: "dist",
  clean: true,
  external: ["@input/pen-core"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
});
