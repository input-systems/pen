import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";
import { scenario } from "../src/scenario";
import type { ScenarioApi } from "../src/types";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * Build output and dependencies, which the previous `rg` call skipped for
 * free by honouring .gitignore. A walk has to name them: dist/ holds a
 * compiled copy of the one file this assertion expects to be unique.
 */
const UNSEARCHED_DIRS = new Set([
	"node_modules",
	"dist",
	".turbo",
	"coverage",
	"__tests__",
]);

/** customCaret paints every collapsed caret; blink supplies the host's animation token. */
const AX6_URL = "/?customCaret=1&blink=1";

const AX6_CARET_BLINK_NAME = "pen-ax6-caret-blink";

function collectFilesContaining(
	directory: string,
	needle: string,
	found: string[],
): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) {
			continue;
		}
		const full = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!UNSEARCHED_DIRS.has(entry.name)) {
				collectFilesContaining(full, needle, found);
			}
			continue;
		}
		if (/\.(test|spec)\./.test(entry.name)) {
			continue;
		}
		if (readFileSync(full, "utf8").includes(needle)) {
			found.push(full);
		}
	}
}

/**
 * Walked in Node rather than shelled out to `rg`: ripgrep is a developer tool,
 * not a runner one, and its absence on ubuntu-latest failed this scenario for
 * the machine rather than for the property. The rule under test is a source
 * one, so it stays cheap either way.
 */
function assertPrefersReducedMotionSingleSite(): void {
	const matches: string[] = [];
	collectFilesContaining(
		join(REPO_ROOT, "packages/rendering"),
		"prefers-reduced-motion",
		matches,
	);
	const files = matches
		.map((file) => relative(REPO_ROOT, file).split(sep).join("/"))
		.sort();
	expect(
		files,
		`AX6 single-site: prefers-reduced-motion must live only in motion.ts\n${files.join("\n")}`,
	).toEqual(["packages/rendering/dom/src/a11y/motion.ts"]);
}

type RunningAnimation = {
	animationName: string | null;
	transitionProperty: string | null;
	target: string | null;
};

async function collectRunningAnimations(
	page: Page,
): Promise<RunningAnimation[]> {
	return page.evaluate(() => {
		const root = document.querySelector("[data-pen-editor-root]");
		if (!(root instanceof HTMLElement)) {
			return [];
		}
		return root
			.getAnimations({ subtree: true })
			.filter((animation) => animation.playState === "running")
			.map((animation) => {
				const effect = animation.effect;
				const target =
					effect && "target" in effect
						? (effect as KeyframeEffect).target
						: null;
				return {
					animationName:
						animation instanceof CSSAnimation
							? animation.animationName
							: null,
					transitionProperty:
						animation instanceof CSSTransition
							? animation.transitionProperty
							: null,
					target:
						target instanceof Element
							? target.tagName.toLowerCase()
							: null,
				};
			});
	});
}

/** Check the media query and the harness agree on `reduced`, then type to paint the caret. */
async function prepareAx6Caret(
	s: ScenarioApi,
	page: Page,
	reduced: boolean,
): Promise<Locator> {
	expect(
		await page.evaluate(
			() => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
		),
	).toBe(reduced);
	expect(
		await page.evaluate(() => window.__penConformance.reducedMotion),
	).toBe(reduced);
	await s.load("hello-world");
	await s.keyboard.type("!");
	await s.assert.textContains("Hello");
	await s.assert.textContains("!");
	const caret = page.locator("[data-pen-editor-caret]");
	await expect(caret).toBeVisible();
	return caret;
}

scenario(
	"AX6: reduced-motion emulation keeps the editor surface free of animated frames",
	async (s, page) => {
		assertPrefersReducedMotionSingleSite();

		const caret = await prepareAx6Caret(s, page, true);
		await expect(
			caret,
			"AX6: caret animation-name must be none under reduced motion",
		).toHaveCSS("animation-name", "none");
		await expect(
			page.locator("[data-pen-editor-root]"),
			"AX6: the root reflects reduced motion for transitions",
		).toHaveAttribute("data-pen-reduced-motion", "");

		const running = await collectRunningAnimations(page);
		expect(running, "AX6: editor surface produced animated frames").toEqual(
			[],
		);
	},
	{
		url: AX6_URL,
		emulateMedia: { reducedMotion: "reduce" },
	},
);

scenario(
	"AX6: without reduced-motion the blink token animates the overlay caret",
	async (s, page) => {
		const caret = await prepareAx6Caret(s, page, false);
		await expect(
			caret,
			"AX6: caret must blink when reduced motion is off",
		).toHaveCSS("animation-name", AX6_CARET_BLINK_NAME);
		await expect(
			page.locator("[data-pen-editor-root]"),
		).not.toHaveAttribute("data-pen-reduced-motion");

		const running = await collectRunningAnimations(page);
		expect(
			running.filter(
				(animation) => animation.animationName === AX6_CARET_BLINK_NAME,
			),
			"AX6: caret blink must be a running animation when reduced motion is off",
		).not.toEqual([]);
	},
	{
		url: AX6_URL,
		emulateMedia: { reducedMotion: "no-preference" },
	},
);
