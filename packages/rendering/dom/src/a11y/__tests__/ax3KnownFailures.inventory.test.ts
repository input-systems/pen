import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOM_SRC = join(HERE, "../..");
const RENDERING = join(DOM_SRC, "../..");
const PACKAGES = join(RENDERING, "..");

const CONTENT_EDITABLE = join(
	DOM_SRC,
	"field-editor/contenteditableBackend.ts",
);
const AUTOCOMPLETE_ACCEPT = join(
	PACKAGES,
	"extensions/ai/src/autocomplete/autocompleteControllerLifecycle.ts",
);
const SCHEDULER = join(DOM_SRC, "scheduler.ts");

describe("AX3 previously-reclassified bugs (rechecked, not trusted)", () => {
	// The slash leftover-query entry is gone because the bug is fixed:
	// `useSlashMenu` confirm now deletes the whole trigger range. The
	// behavioral guard lives with the hook, in
	// `react/src/__tests__/slashMenu.insertionAndFlowFiltering.test.tsx`.

	it("autocomplete caret: updateSelection is no longer a no-op; P1 projects same-turn, not from a scheduler slot", () => {
		const backend = readFileSync(CONTENT_EDITABLE, "utf8");
		expect(backend).toMatch(
			/updateSelection\([^)]*\)\s*:\s*void\s*\{\s*this\.restoreDOMSelectionFromEditor\(\);/,
		);

		const accept = readFileSync(AUTOCOMPLETE_ACCEPT, "utf8");
		expect(accept).toContain("controller._editor.selectText(");
		expect(accept).toContain("commitProgrammaticTextSelection");

		// W3.R8: the scheduler holds no projector; the field editor's
		// selectionChange listener projects in the same turn (P1).
		const scheduler = readFileSync(SCHEDULER, "utf8");
		expect(scheduler).not.toMatch(/onProjectSelection|setProjector/);
	});
});
