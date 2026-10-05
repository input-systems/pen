// B1 map suite. synthetic cases drop EditContext so Chromium uses the
// contenteditable backend that owns the map (same HOST4 seam). typing keeps
// each engine's native backend. f39-beforeinput-structure covers autoformat.
import {
	BEFOREINPUT_MAP,
	mapBeforeInput,
	type BeforeInputMapping,
} from "@input/pen-dom/field-editor/beforeinputMap";
import { expect, type Page } from "@playwright/test";
import { scenario } from "../src/scenario";
import { snapshotBytes } from "../suites/specHelpers";

const UNKNOWN_INPUT_TYPES = [
	"insertOrderedList",
	"formatFontName",
	"insertHorizontalRule",
	"pen-unknown-input-type-lane-50",
] as const;

const BROWSER_MUTATION_MARK = "UNHANDLED-BROWSER-MUTATION";

function disableEditContext(): void {
	delete (globalThis as { EditContext?: unknown }).EditContext;
	delete (window as { EditContext?: unknown }).EditContext;
}

function policyKind(
	mapping: BeforeInputMapping,
): "command" | "allow" | "block" {
	if ("commandName" in mapping) {
		return "command";
	}
	switch (mapping.policy) {
		case "allow":
			return "allow";
		case "block":
			return "block";
		default: {
			const _exhaustive: never = mapping;
			return _exhaustive;
		}
	}
}

async function reloadHello(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.__penConformance.load("hello-world");
	});
	await expect(page.locator('[data-fixture="hello-world"]')).toBeVisible();
	await expect(page.locator("[data-pen-inline-content]").first()).toBeVisible();
	await page.locator("[data-pen-inline-content]").first().click();
	await page.waitForFunction(() => window.__penConformance.hasFieldEditor);
	await page.evaluate(() => {
		window.__penConformance.focusText(0);
	});
	await expect(
		page.locator("[contenteditable='true']").first(),
	).toBeVisible();
	await page.keyboard.press("End");
}

async function dispatchMappedBeforeInput(
	page: Page,
	args: { inputType: string; data?: string },
): Promise<{ defaultPrevented: boolean; threw: string | null }> {
	return page.evaluate((payload) => {
		const surface = document.querySelector("[contenteditable='true']");
		if (!(surface instanceof HTMLElement)) {
			throw new Error("no contenteditable surface");
		}
		const event = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: payload.inputType,
			data: payload.data ?? null,
		});
		// Chromium blanks some composition inputTypes on this constructor
		Object.defineProperty(event, "inputType", {
			configurable: true,
			value: payload.inputType,
		});
		try {
			surface.dispatchEvent(event);
			return {
				defaultPrevented: event.defaultPrevented,
				threw: null,
			};
		} catch (error) {
			return {
				defaultPrevented: event.defaultPrevented,
				threw: error instanceof Error ? error.message : String(error),
			};
		}
	}, args);
}

async function waitForMutationTurn(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => {
					requestAnimationFrame(() => resolve());
				});
			}),
	);
}

scenario(
	"B1: every listed inputType hits its mapped policy",
	async (s, page) => {
		expect(
			await page.evaluate(
				() => typeof (globalThis as { EditContext?: unknown }).EditContext,
			),
		).toBe("undefined");
		await s.load("hello-world");

		const listedTypes = Object.keys(BEFOREINPUT_MAP).sort();
		const harnessMap = await page.evaluate(
			() => window.__penConformance.beforeinputMap,
		);
		expect(
			Object.keys(harnessMap).sort(),
			"Node BEFOREINPUT_MAP and the live harness map must enumerate the same inputTypes",
		).toEqual(listedTypes);
		expect(listedTypes.length).toBeGreaterThan(0);

		const failures: string[] = [];
		for (const inputType of listedTypes) {
			const mapping = mapBeforeInput(inputType);
			const kind = policyKind(mapping);
			if (kind === "block") {
				failures.push(
					`${inputType}: listed map entry resolved to block; listed rows must be command or allow`,
				);
				continue;
			}

			await reloadHello(page);
			await page.evaluate(() => {
				window.__penConformance.clearDiagnostics();
			});

			const data =
				mapping && "commandName" in mapping && mapping.commandName === "pen.insertText"
					? "Q"
					: undefined;
			const dispatched = await dispatchMappedBeforeInput(page, {
				inputType,
				data,
			});
			const diagnostics = await page.evaluate(
				() => window.__penConformance.diagnostics,
			);
			const unhandled = diagnostics.some(
				(event) => event.code === "unhandled-input-type",
			);

			if (dispatched.threw) {
				failures.push(`${inputType}: handler threw (${dispatched.threw})`);
			}
			if (unhandled) {
				failures.push(`${inputType}: listed type emitted unhandled-input-type`);
			}
			if (kind === "command" && !dispatched.defaultPrevented) {
				failures.push(
					`${inputType}: command policy requires preventDefault, event was not cancelled`,
				);
			}
			if (kind === "allow" && dispatched.defaultPrevented) {
				failures.push(
					`${inputType}: allow policy must leave composition to the field, but preventDefault ran`,
				);
			}
		}

		expect(failures, failures.join("\n")).toEqual([]);
	},
	{ axe: false, initScript: disableEditContext },
);

scenario(
	"B1: unknown inputType produces unhandled-input-type and leaves the document unchanged",
	async (s, page) => {
		expect(
			await page.evaluate(
				() => typeof (globalThis as { EditContext?: unknown }).EditContext,
			),
		).toBe("undefined");
		await s.load("hello-world");
		s.expectDiagnostic("unhandled-input-type");

		const failures: string[] = [];
		for (const inputType of UNKNOWN_INPUT_TYPES) {
			if (inputType in BEFOREINPUT_MAP) {
				failures.push(`${inputType}: unexpectedly present in BEFOREINPUT_MAP`);
				continue;
			}
			if (policyKind(mapBeforeInput(inputType)) !== "block") {
				failures.push(`${inputType}: mapBeforeInput did not return block`);
				continue;
			}

			await reloadHello(page);
			await page.evaluate(() => {
				window.__penConformance.clearDiagnostics();
			});
			const before = snapshotBytes(
				await page.evaluate(() => window.__penConformance.documentSnapshot()),
			);

			const dispatched = await dispatchMappedBeforeInput(page, {
				inputType,
			});
			await page.evaluate((mark) => {
				window.__penConformance.mutateActiveSurfaceText(mark);
			}, BROWSER_MUTATION_MARK);
			await waitForMutationTurn(page);

			const after = snapshotBytes(
				await page.evaluate(() => window.__penConformance.documentSnapshot()),
			);
			const diagnostics = await page.evaluate(
				() => window.__penConformance.diagnostics,
			);
			const unhandled = diagnostics.filter(
				(event) => event.code === "unhandled-input-type",
			);
			const documentText = await page.evaluate(
				() => window.__penConformance.documentText,
			);

			if (dispatched.threw) {
				failures.push(`${inputType}: dispatch threw (${dispatched.threw})`);
			}
			if (!dispatched.defaultPrevented) {
				failures.push(`${inputType}: block policy did not preventDefault`);
			}
			if (unhandled.length !== 1) {
				failures.push(
					`${inputType}: expected one unhandled-input-type, got ${
						diagnostics.map((event) => event.code).join(", ") ||
						"no diagnostics"
					}`,
				);
			}
			if (after !== before) {
				failures.push(
					`${inputType}: authority document changed after unknown beforeinput`,
				);
			}
			if (documentText.includes(BROWSER_MUTATION_MARK)) {
				failures.push(
					`${inputType}: authority absorbed the simulated browser mutation`,
				);
			}
		}

		expect(failures, failures.join("\n")).toEqual([]);
	},
	{ axe: false, initScript: disableEditContext },
);

scenario(
	"B1: typing on Chromium, WebKit, and Firefox emits zero dom-divergence",
	async (s, page) => {
		await s.load("hello-world");
		await s.keyboard.type(" abc");
		await s.assert.textContains("Hello");
		await s.assert.textContains("abc");
		await s.keyboard.press("Enter");
		await s.keyboard.type("x");
		await s.keyboard.press("Backspace");

		const divergences = await page.evaluate(() =>
			window.__penConformance.diagnostics.filter(
				(event) => event.code === "dom-divergence",
			),
		);
		expect(
			divergences,
			`dom-divergence fired ${divergences.length} time(s) during real typing`,
		).toEqual([]);
		await s.assert.domMatchesAuthority();
	},
);
