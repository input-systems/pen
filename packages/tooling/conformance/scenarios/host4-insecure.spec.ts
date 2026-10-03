import { expect, test } from "@playwright/test";
import { HARNESS_PORT } from "../src/harnessPort";
import { scenario } from "../src/scenario";

const INSECURE_ORIGIN = `http://pen.test:${HARNESS_PORT}`;

test.use({
	baseURL: INSECURE_ORIGIN,
	launchOptions: {
		args: ["--host-resolver-rules=MAP pen.test 127.0.0.1"],
	},
});

test.skip(
	({ browserName }) => browserName !== "chromium",
	"Chromium --host-resolver-rules maps pen.test off the localhost secure-context special case",
);

scenario(
	"HOST4: plain HTTP on a non-localhost host constructs and types without randomUUID",
	async (s, page) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => {
			errors.push(error.message);
		});

		const context = await page.evaluate(() => ({
			origin: window.location.origin,
			isSecureContext: window.isSecureContext,
			// The rule bans this probe outside `generateId` because a feature test there
			// means someone is re-implementing the fallback `generateId` owns. This is the
			// third case it did not anticipate: not a fallback but the assertion that the
			// API is genuinely absent, which is the precondition the rest of this scenario
			// depends on. Asserting it rather than assuming it is what makes the scenario
			// prove something about plain HTTP instead of about a browser that happened to
			// expose the API anyway.
			// eslint-disable-next-line pen/no-bare-random-uuid -- probing for absence, not calling; see above
			hasRandomUUID: typeof crypto.randomUUID === "function",
		}));
		expect(context.origin).toBe(INSECURE_ORIGIN);
		expect(context.isSecureContext).toBe(false);
		expect(context.hasRandomUUID).toBe(false);

		await s.load("hello-world");
		await s.keyboard.type("!");
		await s.assert.textContains("Hello");
		await s.assert.textContains("!");

		const diagnostics = await page.evaluate(
			() => window.__penConformance.diagnostics,
		);
		expect(errors, errors.join("\n")).toEqual([]);
		expect(diagnostics.filter((item) => item.level === "error")).toEqual([]);
	},
);
