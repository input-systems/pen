import { expect, test, type Browser, type Page } from "@playwright/test";
import { analyzeEditorWcag22Aa } from "./axeSurface";
import { formatAxeViolations } from "./axeFormat";
import { createPageRelay, type PageRelay } from "./peerRelay";
import type { KnownDefect } from "./scenario";
import {
	assertStandingDiagnostics,
	assertStandingDomMatchesAuthority,
	assertStandingOverlayMatchesAuthority,
} from "./standingAssertions";

/**
 * Two real editors on two pages over a counted relay (W5.R10). Each peer is
 * its own browser context loading `?peer=<id>&relay=1&col2=1`, so each page
 * owns its DOM selection and S2 holds on both. Peer b forks from peer a's
 * encoded state with its own client id. `standing()` runs the S2, OV4 and
 * diagnostics standing assertions on both pages.
 */

export interface EditorPeer {
	readonly id: "a" | "b";
	readonly page: Page;
}

export interface TwoEditorApi {
	readonly a: EditorPeer;
	readonly b: EditorPeer;
	readonly relay: PageRelay;
	/** Standing assertions on both pages. */
	standing(): Promise<void>;
	/** Each page's `documentSnapshot()`; equal on a converged pair. */
	snapshots(): Promise<{ a: unknown; b: unknown }>;
	/** Pumps the relay live until both outboxes are empty, then checks the pair converged. */
	converge(): Promise<void>;
}

const PEER_B_CLIENT_ID = 4_242_424;

async function openPeer(
	browser: Browser,
	id: "a" | "b",
	baseURL: string | undefined,
	initScript: (() => void) | undefined,
): Promise<EditorPeer> {
	const context = await browser.newContext({ baseURL });
	if (initScript) {
		await context.addInitScript(initScript);
	}
	const page = await context.newPage();
	await page.goto(`/?peer=${id}&relay=1&col2=1`);
	await expect(page.locator("[data-pen-inline-content]").first()).toBeVisible();
	return { id, page };
}

export function twoEditorScenario(
	name: string,
	fn: (api: TwoEditorApi) => Promise<void>,
	options?: {
		readonly fixture?: string;
		readonly axe?: boolean;
		readonly knownDefect?: KnownDefect;
		/** Runs before page scripts on both pages, e.g. to disable EditContext. */
		readonly initScript?: () => void;
	},
): void {
	test(name, async ({ browser, baseURL }) => {
		if (options?.knownDefect) {
			const { rule, route, symptom } = options.knownDefect;
			test.fail(true, `${rule} — ${symptom} (route: ${route})`);
		}
		const a = await openPeer(browser, "a", baseURL, options?.initScript);
		const b = await openPeer(browser, "b", baseURL, options?.initScript);
		try {
			const fixture = options?.fixture ?? "hello-world";
			await a.page.evaluate((name) => window.__penConformance.load(name), fixture);
			const seed = await a.page.evaluate(() =>
				window.__penConformance.relay!.encodeSince(""),
			);
			await b.page.evaluate(
				({ name, update, clientId }) =>
					window.__penConformance.loadSeeded(name, update, clientId),
				{ name: fixture, update: seed, clientId: PEER_B_CLIENT_ID },
			);
			for (const peer of [a, b]) {
				await expect(peer.page.locator(`[data-fixture="${fixture}"]`)).toBeVisible();
			}
			// The fixture's own writes were in the seed: start both outboxes empty.
			for (const peer of [a, b]) {
				await peer.page.evaluate(() => window.__penConformance.relay!.drainOutbox());
			}
			for (const peer of [a, b]) {
				expect(
					await peer.page.evaluate(() => document.hasFocus()),
					`page ${peer.id} has emulated focus`,
				).toBe(true);
			}

			const relay = createPageRelay([a, b]);
			const api: TwoEditorApi = {
				a,
				b,
				relay,
				async standing() {
					for (const peer of [a, b]) {
						await assertStandingDomMatchesAuthority(peer.page);
						await assertStandingOverlayMatchesAuthority(peer.page);
						await assertStandingDiagnostics(peer.page, new Set());
					}
				},
				async snapshots() {
					const read = (page: Page) =>
						page.evaluate(() => window.__penConformance.documentSnapshot());
					return { a: await read(a.page), b: await read(b.page) };
				},
				async converge() {
					await relay.live();
					await relay.pump();
					const { a: left, b: right } = await api.snapshots();
					expect(right, "both pages converge").toEqual(left);
				},
			};
			await fn(api);
			await api.standing();
			if (options?.axe !== false) {
				for (const peer of [a, b]) {
					const results = await analyzeEditorWcag22Aa(peer.page);
					expect(
						results.violations,
						formatAxeViolations(results.violations, `standing: axe on page ${peer.id}`),
					).toEqual([]);
				}
			}
		} finally {
			await a.page.context().close();
			await b.page.context().close();
		}
	});
}
