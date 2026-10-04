import { expect, type Page } from "@playwright/test";
import {
	MAX_PRESENCE_ANCHOR_LENGTH,
	MAX_PRESENCE_BYTES_PER_PEER,
	MAX_PRESENCE_DISPLAY_NAME_LENGTH,
	MAX_PRESENCE_UPDATES_PER_SECOND,
	MAX_TRACKED_PEERS,
} from "../../../extensions/multiplayer/src/presence/constants";
import { scenario } from "../src/scenario";
import { collectPageErrors } from "../src/specHelpers";

const GOOD_PEER_ID = 77;
const STALE_PEER_ID = 78;
const PEER_COLOR = "#0b4f8c";
const HOSTILE_AVATAR_JS = "javascript:window.__xssProbe()";
const HOSTILE_AVATAR_HTML =
	"data:text/html,<script>window.__xssProbe()</script>";
const SCRIPT_NAME = '"><img src=x onerror="window.__xssProbe()">';

async function serializePresenceAnchors(
	page: Page,
	points: ReadonlyArray<{ key: string; blockId: string; offset: number }>,
): Promise<Record<string, string>> {
	return page.evaluate((requested) => {
		const encoded: Record<string, string> = {};
		for (const point of requested) {
			encoded[point.key] = window.__penConformance.serializePresenceAnchor(
				point.blockId,
				point.offset,
			);
		}
		return encoded;
	}, points);
}

async function waitForMultiplayer(page: Page): Promise<void> {
	await expect
		.poll(() => page.evaluate(() => window.__penConformance.hasMultiplayer))
		.toBe(true);
	await expect(
		page.locator("[data-pen-multiplayer-remote-cursors]"),
	).toBeAttached();
	await expect(
		page.locator("[data-pen-multiplayer-presence-list]"),
	).toBeAttached();
}

async function scanPresenceSurface(page: Page) {
	return page.evaluate(() => {
		const root = document.querySelector("[data-pen-editor-root]");
		const urlAttributes: string[] = [];
		const liveUrls: string[] = [];
		if (root) {
			for (const element of root.querySelectorAll("[src], [href]")) {
				const src = element.getAttribute("src");
				const href = element.getAttribute("href");
				if (src) {
					urlAttributes.push(src);
				}
				if (href) {
					urlAttributes.push(href);
				}
				if (element instanceof HTMLImageElement && element.src) {
					liveUrls.push(element.src);
				}
				if (element instanceof HTMLAnchorElement && element.href) {
					liveUrls.push(element.href);
				}
			}
		}
		const isHostile = (value: string) =>
			/javascript:/i.test(value) || /data:\s*text\/html/i.test(value);
		return {
			documentText: window.__penConformance.documentText,
			probeTripped: Boolean(window.__xssProbeTripped),
			cursorCount: window.__penConformance.presence.cursors.length,
			peerCount: window.__penConformance.presence.peers.length,
			cursors: window.__penConformance.presence.cursors,
			peers: window.__penConformance.presence.peers,
			renderedUserIds: [
				...document.querySelectorAll(
					"[data-pen-multiplayer-remote-cursor][data-user-id], [data-pen-multiplayer-presence-avatar][data-user-id], [data-pen-multiplayer-caret][data-user-id]",
				),
			].map((element) => element.getAttribute("data-user-id")),
			renderedNames: [
				...document.querySelectorAll(
					"[data-pen-multiplayer-remote-cursor], [data-pen-multiplayer-presence-avatar], [data-pen-multiplayer-caret-label]",
				),
			].map((element) => element.textContent ?? ""),
			hostileAttributes: urlAttributes.filter(isHostile),
			hostileLiveUrls: liveUrls.filter(isHostile),
			overlayCursorCount: Number(
				document
					.querySelector("[data-pen-multiplayer-remote-cursors]")
					?.getAttribute("data-cursor-count") ?? "-1",
			),
		};
	});
}

scenario(
	"COL2: hostile presence keeps the live surface intact",
	async (s, page) => {
		const pageErrors = collectPageErrors(page);

		await s.load("two-paragraph");
		await waitForMultiplayer(page);
		await s.assert.xssProbeNotTripped();

		const rateOffsets = Array.from({ length: 13 }, (_, offset) => offset);
		const anchors = await serializePresenceAnchors(page, [
			{ key: "good", blockId: "two-p1", offset: 2 },
			{ key: "stale", blockId: "two-p2", offset: 1 },
			{ key: "inRange", blockId: "two-p1", offset: 1 },
			...rateOffsets.map((offset) => ({
				key: `rate-${offset}`,
				blockId: "two-p1",
				offset,
			})),
		]);

		const goodPeer = {
			clientId: GOOD_PEER_ID,
			state: {
				user: { id: "u-good", name: "Grace", color: PEER_COLOR },
				cursor: { anchor: anchors.good, clock: 10 },
			},
		};
		const stalePeer = {
			clientId: STALE_PEER_ID,
			state: {
				user: { id: "u-stale", name: "SoonGone", color: PEER_COLOR },
				cursor: { anchor: anchors.stale, clock: 11 },
			},
		};

		const afterHostile = await s.remote.injectPresence([
			goodPeer,
			stalePeer,
			{
				clientId: 88,
				state: {
					user: {
						id: "u-oversize",
						name: "x".repeat(MAX_PRESENCE_DISPLAY_NAME_LENGTH + 1),
					},
					cursor: { anchor: anchors.inRange, clock: 12 },
				},
			},
			{
				clientId: 89,
				state: {
					user: { id: "u-huge", name: "Pad" },
					padding: "x".repeat(MAX_PRESENCE_BYTES_PER_PEER),
					cursor: { anchor: anchors.inRange, clock: 13 },
				},
			},
			{
				clientId: 90,
				state: {
					user: { id: 2, name: "Invalid" },
					cursor: { anchor: anchors.inRange, clock: 14 },
				},
			},
			{
				clientId: 91,
				state: {
					user: { id: "u-xss", name: SCRIPT_NAME },
					cursor: { anchor: anchors.inRange, clock: 15 },
				},
			},
			{
				clientId: 92,
				state: {
					user: {
						id: "u-js",
						name: "HostileJs",
						avatar: HOSTILE_AVATAR_JS,
					},
					cursor: { anchor: anchors.inRange, clock: 16 },
				},
			},
			{
				clientId: 93,
				state: {
					user: {
						id: "u-html",
						name: "HostileHtml",
						avatar: HOSTILE_AVATAR_HTML,
					},
					cursor: { anchor: anchors.inRange, clock: 17 },
				},
			},
			{
				clientId: 94,
				state: {
					user: { id: "u-ghost", name: "Ghost", color: PEER_COLOR },
					cursor: { blockId: "missing-block", offset: 0, clock: 18 },
					selection: {
						kind: "block",
						blockIds: ["missing-block"],
						clock: 18,
					},
				},
			},
			{
				clientId: 95,
				state: {
					user: { id: "u-far", name: "Far", color: PEER_COLOR },
					cursor: {
						anchor: "x".repeat(MAX_PRESENCE_ANCHOR_LENGTH + 1),
						clock: 19,
					},
				},
			},
			{
				clientId: 96,
				state: {
					user: { id: "u-malformed", name: "Broken", color: PEER_COLOR },
					cursor: { anchor: "{not-json", clock: 20 },
				},
			},
		]);

		expect(afterHostile.cursors.map((cursor) => cursor.userId).sort()).toEqual([
			"u-good",
			"u-stale",
		]);
		expect(afterHostile.cursors.some((cursor) => cursor.avatar)).toBe(false);

		await expect(
			page.locator(
				'[data-pen-multiplayer-remote-cursor][data-user-id="u-good"]',
			),
		).toHaveText("Grace");
		await expect(
			page.locator(
				'[data-pen-multiplayer-presence-avatar][data-user-id="u-good"]',
			),
		).toBeVisible();

		const hostileSurface = await scanPresenceSurface(page);
		expect(hostileSurface.probeTripped, "window.__xssProbe was called").toBe(
			false,
		);
		expect(hostileSurface.hostileAttributes, "hostile URL in an attribute").toEqual(
			[],
		);
		expect(hostileSurface.hostileLiveUrls, "hostile URL became a live src/href").toEqual(
			[],
		);
		expect(hostileSurface.renderedUserIds).toContain("u-good");
		expect(hostileSurface.renderedUserIds).toContain("u-stale");
		expect(hostileSurface.renderedUserIds).not.toContain("u-xss");
		expect(hostileSurface.renderedUserIds).not.toContain("u-js");
		expect(hostileSurface.renderedUserIds).not.toContain("u-html");
		expect(hostileSurface.cursors.map((cursor) => cursor.userId)).not.toContain(
			"u-ghost",
		);
		expect(hostileSurface.cursors.map((cursor) => cursor.userId)).not.toContain(
			"u-far",
		);
		expect(hostileSurface.cursors.map((cursor) => cursor.userId)).not.toContain(
			"u-malformed",
		);
		expect(hostileSurface.renderedNames.join("\n")).not.toContain("<script");
		expect(hostileSurface.renderedNames.join("\n")).not.toContain(
			"window.__xssProbe",
		);
		expect(hostileSurface.documentText).toContain("Alpha bravo charlie");
		await s.assert.corpusSafe();
		await s.assert.xssProbeNotTripped();

		await s.remote.apply([
			{
				type: "delete-block",
				blockId: "two-p2",
			},
		]);
		await s.assert.textContains("Alpha bravo charlie");
		await expect(
			page.locator("[data-pen-inline-content]").first(),
		).toBeVisible();
		await expect(
			page.locator(
				'[data-pen-multiplayer-remote-cursor][data-user-id="u-good"]',
			),
		).toBeVisible();

		const afterDelete = await scanPresenceSurface(page);
		expect(afterDelete.probeTripped).toBe(false);
		expect(afterDelete.hostileLiveUrls).toEqual([]);
		expect(afterDelete.cursors.map((cursor) => cursor.userId)).toEqual([
			"u-good",
		]);
		expect(afterDelete.peers.map((peer) => peer.userId)).toContain("u-stale");
		expect(pageErrors, pageErrors.join("\n")).toEqual([]);

		const rateUpdates = [];
		for (let index = 0; index < MAX_PRESENCE_UPDATES_PER_SECOND + 8; index += 1) {
			const offset = Math.min(index, 12);
			rateUpdates.push({
				clientId: GOOD_PEER_ID,
				state: {
					user: { id: "u-good", name: "Grace", color: PEER_COLOR },
					cursor: {
						anchor: anchors[`rate-${offset}`],
						clock: 100 + index,
					},
				},
			});
		}
		const afterRate = await s.remote.injectPresence(rateUpdates);
		expect(afterRate.cursors.filter((cursor) => cursor.userId === "u-good")).toHaveLength(
			1,
		);
		expect(
			afterRate.cursors.find((cursor) => cursor.userId === "u-good")?.offset,
		).not.toBe(12);

		await s.keyboard.type("!");
		await s.assert.textContains("Alpha");
		await s.assert.textContains("!");

		const flood: Array<{
			clientId: number;
			state: Record<string, unknown>;
		}> = [];
		for (let index = 0; index < MAX_TRACKED_PEERS + 8; index += 1) {
			flood.push({
				clientId: 400 + index,
				state: {
					user: {
						id: `u-flood-${index}`,
						name: `Flood ${index}`,
						color: PEER_COLOR,
					},
					cursor: { anchor: anchors.inRange, clock: 200 + index },
				},
			});
		}

		const floodStarted = Date.now();
		const afterFlood = await s.remote.injectPresence(flood);
		const floodMs = Date.now() - floodStarted;
		expect(floodMs, `peer-cap flood hung the surface (${floodMs}ms)`).toBeLessThan(
			5_000,
		);
		expect(afterFlood.cursors.length).toBeLessThanOrEqual(MAX_TRACKED_PEERS);
		expect(afterFlood.peers.length).toBeLessThanOrEqual(MAX_TRACKED_PEERS);

		const floodSurface = await scanPresenceSurface(page);
		expect(floodSurface.overlayCursorCount).toBeLessThanOrEqual(MAX_TRACKED_PEERS);
		expect(floodSurface.overlayCursorCount).toBe(afterFlood.cursors.length);
		expect(floodSurface.probeTripped).toBe(false);
		expect(floodSurface.hostileLiveUrls).toEqual([]);
		expect(floodSurface.renderedUserIds).toContain("u-good");

		await s.keyboard.type("?");
		await s.assert.textContains("?");
		await s.assert.corpusSafe();
		await s.assert.xssProbeNotTripped();
		await s.assert.focusInsideEditor();

		const reasons = await page.evaluate(() =>
			window.__penConformance.diagnostics
				.filter((event) => event.code === "presence-rejected")
				.map((event) => event.reason)
				.filter((reason): reason is string => typeof reason === "string"),
		);
		for (const reason of [
			"oversized",
			"wrong-typed",
			"script-bearing",
			"nonexistent-block",
			"rate-limited",
			"peer-cap",
		]) {
			expect(reasons, `missing ${reason} rejection`).toContain(reason);
		}
		expect(pageErrors, pageErrors.join("\n")).toEqual([]);
	},
	{ url: "/?col2=1" },
);
