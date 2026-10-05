import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: { compilerOptions: { stripInternal: true, ignoreDeprecations: "6.0" } },
  outDir: "dist",
  clean: true,
  outExtension({ format }) {
    return { js: format === "esm" ? ".mjs" : ".cjs" };
  },
});
