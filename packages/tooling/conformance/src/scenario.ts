import type { DocumentOp } from "@input/pen-types";
import { expect, test, type Page } from "@playwright/test";
import { analyzeEditorWcag22Aa, formatAxeViolations } from "./axeSurface";
import { formatCheckReport } from "./checkReport";
import { getInlineOffsetPoint, resolveBlockId } from "./domGeometry";
import {
	assertDomAuthorityResult,
	assertStandingDiagnostics,
	assertStandingDomMatchesAuthority,
	assertStandingOverlayMatchesAuthority,
} from "./standingAssertions";
import type {
	DragTextArgs,
	GeometryPoint,
	GeometryPointRef,
	RemoteSpliceArgs,
	ScenarioApi,
	SelectionEqualsArgs,
} from "./types";

/**
 * A scenario that asserts the spec correctly and fails because the product is
 * wrong. Marked expected-to-fail so `conformance-chromium` stays honest instead
 * of sitting permanently red — a red job nobody can act on is how a real
 * regression hides (WebKit spent a week that way).
 *
 * The assertion is NOT weakened: it still states what the spec requires, so
 * when the defect is fixed Playwright reports the scenario as unexpectedly
 * passing and the job goes red until the annotation is removed.
 *
 * The cost, stated because it is real: a scenario that fails for the WRONG
 * reason — a broken selector, a fixture that stopped loading — also counts as
 * expected. Every entry therefore records the exact observed `symptom` in the
 * conformance README, so the claim can be re-verified rather than trusted.
 */
export interface KnownDefect {
	/** Spec rule the product violates, e.g. `"K1"`. */
	rule: string;
	/** Where the fix belongs, so the entry routes itself. */
	route: string;
	/** Observed failure, verbatim, so a wrong-reason pass is detectable. */
	symptom: string;
}

export function scenario(
	name: string,
	fn: (s: ScenarioApi, page: Page) => Promise<void>,
	options?: {
		url?: string;
		axe?: boolean;
		emulateMedia?: {
			reducedMotion?: "reduce" | "no-preference";
		};
		initScript?: () => void;
		knownDefect?: KnownDefect;
	},
): void {
	test(name, async ({ page }) => {
		if (options?.knownDefect) {
			const { rule, route, symptom } = options.knownDefect;
			test.fail(true, `${rule} — ${symptom} (route: ${route})`);
		}
		if (options?.initScript) {
			await page.addInitScript(options.initScript);
		}
		if (options?.emulateMedia) {
			await page.emulateMedia(options.emulateMedia);
		}
		await page.goto(options?.url ?? "/");
		await expect(
			page.locator("[data-pen-inline-content]").first(),
		).toBeVisible();
		await fn(createScenario(page), page);
		if (options?.axe === false) {
			return;
		}
		const results = await analyzeEditorWcag22Aa(page);
		expect(
			results.violations,
			formatAxeViolations(results.violations, "standing: axe WCAG 2.2 AA"),
		).toEqual([]);
	});
}

function createScenario(page: Page): ScenarioApi {
	const expectedDiagnostics = new Set<string>();

	async function standing(): Promise<void> {
		// OV4 runs a flush first, so a D5 substitute's overlay paint (part of
		// the S2 check, W3.R2) is on the layer when S2 reads it.
		await assertStandingOverlayMatchesAuthority(page);
		await assertStandingDomMatchesAuthority(page);
		await assertStandingDiagnostics(page, expectedDiagnostics);
	}

	async function step<T>(
		run: () => Promise<T>,
		options?: { skipStanding?: boolean },
	): Promise<T> {
		const result = await run();
		if (!options?.skipStanding) {
			await standing();
		}
		return result;
	}

	return {
		async load(name: string, options?: { pointer?: boolean }) {
			await step(async () => {
				await page.evaluate((fixtureName) => {
					window.__penConformance.load(fixtureName);
				}, name);
				await expect(
					page.locator(`[data-fixture="${name}"]`),
				).toBeVisible();
				await expect(
					page.locator("[data-pen-inline-content]").first(),
				).toBeVisible();
				if (options?.pointer === false) {
					await page.waitForFunction(
						() => window.__penConformance.hasFieldEditor,
					);
					await page.evaluate(() => {
						window.__penConformance.focusText(0);
					});
					await expect(
						page.locator("[data-pen-field-editor-active-surface]"),
					).toBeVisible();
					return;
				}
				await page.locator("[data-pen-inline-content]").first().click();
			});
		},
		async apply(ops: readonly DocumentOp[]) {
			await step(async () => {
				await page.evaluate((tools) => {
					window.__penConformance.apply(tools);
				}, ops);
			});
		},
		async selectText(block: number, offset = 0) {
			await step(async () => {
				await page.evaluate(
					(target) => {
						window.__penConformance.selectText(target.block, target.offset);
					},
					{ block, offset },
				);
			});
		},
		async applyAiRangeReplacement(args) {
			await step(async () => {
				await page.evaluate((replacement) => {
					window.__penConformance.applyAiRangeReplacement(replacement);
				}, args);
			});
		},
		async applyToolPayloads(payloadsJson: string) {
			return step(async () => {
				return page.evaluate((raw) => {
					return window.__penConformance.applyToolPayloads(
						JSON.parse(raw) as unknown[],
					);
				}, payloadsJson);
			});
		},
		async importHtml(html: string) {
			await step(async () => {
				await page.evaluate((source) => {
					return window.__penConformance.importHtml(source);
				}, html);
			});
		},
		async pasteHtml(html: string) {
			await step(async () => {
				await page.evaluate((source) => {
					return window.__penConformance.pasteHtml(source);
				}, html);
			});
		},
		keyboard: {
			async type(text: string) {
				await step(async () => {
					await page.keyboard.type(text);
				});
			},
			async press(key: string) {
				await step(async () => {
					await page.keyboard.press(key);
				});
			},
		},
		mouse: {
			async dragText(args: DragTextArgs) {
				await step(async () => {
					const from = await getInlineOffsetPoint(page, args.from);
					const to = await getInlineOffsetPoint(page, args.to);
					await page.mouse.move(from.x, from.y);
					await page.mouse.down();
					await page.mouse.move(to.x, to.y);
					await page.mouse.up();
				});
			},
		},
		remote: {
			async splice(args: RemoteSpliceArgs) {
				await step(async () => {
					await page.evaluate((splice) => {
						window.__penConformance.remoteSplice(splice);
					}, args);
				});
			},
			async apply(ops: readonly DocumentOp[]) {
				await step(async () => {
					await page.evaluate((tools) => {
						window.__penConformance.remoteApply(tools);
					}, ops);
				});
			},
			async injectY(args) {
				await step(async () => {
					await page.evaluate((inject) => {
						window.__penConformance.remoteInjectY(inject);
					}, args);
				});
			},
			async injectPresence(peers) {
				return step(async () => {
					return page.evaluate((presence) => {
						return window.__penConformance.injectPresence(presence);
					}, peers);
				});
			},
		},
		expectDiagnostic(code) {
			expectedDiagnostics.add(code);
		},
		async installBrokenProjector() {
			await step(
				async () => {
					await page.evaluate(() => {
						window.__penConformance.installBrokenProjector();
					});
				},
				{ skipStanding: true },
			);
		},
		async forceUnwindowedDomDivergence() {
			return step(
				async () => {
					return page.evaluate(() =>
						window.__penConformance.forceUnwindowedDomDivergence(),
					);
				},
				{ skipStanding: true },
			);
		},
		geometry: {
			async blocks() {
				return page.evaluate(() => window.__penConformance.geometryBlocks());
			},
			async lineBoxes(blockId: string) {
				return page.evaluate(
					(id) => window.__penConformance.geometryLineBoxes(id),
					blockId,
				);
			},
			async invalidate() {
				await page.evaluate(() => {
					window.__penConformance.invalidateGeometry();
				});
			},
			async warm(points: readonly GeometryPointRef[]) {
				await page.evaluate((caretPoints) => {
					window.__penConformance.warmCaretCache(caretPoints);
				}, points);
			},
			async compare(points: readonly GeometryPointRef[]) {
				return page.evaluate((caretPoints) => {
					return window.__penConformance.compareCaretCache(caretPoints);
				}, points);
			},
			async verticalMotion(args: {
				situation: string;
				from: GeometryPoint;
				direction: "up" | "down";
				goalX?: number | null;
			}) {
				return page.evaluate((motion) => {
					return window.__penConformance.verticalMotion(motion);
				}, args);
			},
			async flushEightRemoteCarets(points: readonly GeometryPoint[]) {
				return page.evaluate((carets) => {
					return window.__penConformance.flushEightRemoteCarets(carets);
				}, points);
			},
		},
		assert: {
			async selectionEquals(expected: SelectionEqualsArgs) {
				await step(async () => {
					const anchorBlockId = await resolveBlockId(page, expected.anchor);
					const focusBlockId = await resolveBlockId(page, expected.focus);
					const selection = await page.evaluate(
						() => window.__penConformance.selection,
					);
					expect(selection).toMatchObject({
						type: "text",
						anchor: {
							blockId: anchorBlockId,
							offset: expected.anchor.offset,
						},
						focus: {
							blockId: focusBlockId,
							offset: expected.focus.offset,
						},
					});
				});
			},
			async domMatchesAuthority() {
				const result = await page.evaluate(() =>
					window.__penConformance.domMatchesAuthority(),
				);
				assertDomAuthorityResult(result);
				await assertStandingDiagnostics(page, expectedDiagnostics);
			},
			async textContains(text: string) {
				await step(async () => {
					const documentText = await page.evaluate(
						() => window.__penConformance.documentText,
					);
					expect(documentText).toContain(text);
				});
			},
			async corpusSafe(options?: { requireBlockedUrl?: boolean }) {
				const scan = await page.evaluate(() =>
					window.__penConformance.scanHostileDom(),
				);
				expect(
					scan.probeTripped,
					formatCheckReport(
						"corpusSafe: xss probe",
						scan.probeTripped ? "failed" : "passed",
						scan.probeTripped ? "window.__xssProbe was called" : undefined,
					),
				).toBe(false);
				expect(
					scan.javascriptUrls,
					formatCheckReport(
						"corpusSafe: javascript URLs",
						scan.javascriptUrls.length > 0 ? "failed" : "passed",
						scan.javascriptUrls.length > 0
							? "javascript: reached a URL attribute"
							: undefined,
					),
				).toEqual([]);
				if (options?.requireBlockedUrl) {
					expect(
						scan.blockedUrlCount,
						formatCheckReport(
							"corpusSafe: blocked URL",
							scan.blockedUrlCount > 0 ? "passed" : "failed",
							scan.blockedUrlCount > 0
								? undefined
								: "expected at least one blocked URL",
						),
					).toBeGreaterThan(0);
				}
			},
			async xssProbeNotTripped() {
				const scan = await page.evaluate(() =>
					window.__penConformance.scanHostileDom(),
				);
				expect(
					scan.probeTripped,
					formatCheckReport(
						"xss probe",
						scan.probeTripped ? "failed" : "passed",
						scan.probeTripped ? "window.__xssProbe was called" : undefined,
					),
				).toBe(false);
			},
			async focusInsideEditor() {
				const inside = await page.evaluate(() => {
					const root = document.querySelector("[data-pen-editor-root]");
					const active = document.activeElement;
					return (
						root instanceof HTMLElement &&
						active instanceof Node &&
						root.contains(active)
					);
				});
				expect(
					inside,
					formatCheckReport(
						"focus inside editor",
						inside ? "passed" : "failed",
						inside ? undefined : "focus left the editor surface",
					),
				).toBe(true);
			},
		},
	};
}