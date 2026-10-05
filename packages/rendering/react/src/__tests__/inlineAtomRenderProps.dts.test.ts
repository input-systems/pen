import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_DTS = join(PACKAGE_ROOT, "dist/index.d.ts");
// TS 7's exports map hides bin/, so reach it through package.json.
const TSC = join(
	dirname(
		createRequire(import.meta.url).resolve(
			"@typescript/native/package.json",
		),
	),
	"bin/tsc",
);

describe("InlineAtomRenderProps declaration emit", () => {
	it("emitted d.ts imports InlineAtomRenderInteractionProps", () => {
		const dts = readFileSync(DIST_DTS, "utf8");
		expect(dts).toMatch(
			/import\s*\{[^}]*InlineAtomRenderInteractionProps[^}]*\}\s*from\s*['"]@input\/pen-dom\/field-editor\/inlineAtomInteraction['"]/,
		);
		expect(dts).toMatch(
			/interaction\?:\s*InlineAtomRenderInteractionProps/,
		);
	});

	it("a consumer compiles against the built d.ts with skipLibCheck false", () => {
		const scratch = join(PACKAGE_ROOT, ".tmp-dts-consumer");
		rmSync(scratch, { recursive: true, force: true });
		mkdirSync(scratch, { recursive: true });
		try {
			writeFileSync(
				join(scratch, "consumer.ts"),
				`import type { InlineAtomRenderProps } from "@input/pen-react";

export function readCanRemove(
	props: InlineAtomRenderProps,
): boolean | undefined {
	return props.interaction?.canRemove;
}
`,
			);
			writeFileSync(
				join(scratch, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						strict: true,
						skipLibCheck: false,
						module: "nodenext",
						moduleResolution: "nodenext",
						target: "es2022",
						noEmit: true,
						types: [],
					},
					include: ["consumer.ts"],
				}),
			);
			execFileSync(TSC, ["-p", scratch], {
				cwd: PACKAGE_ROOT,
				stdio: "pipe",
			});
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	});
});
