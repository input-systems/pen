import { expect, test } from "@playwright/test";
import { MODIFIER, openPlayground } from "./penPlayground.utils";

test("opens the inline AI prompt with Mod+J", async ({ page }) => {
	await openPlayground(page);

	await page.locator("[data-pen-editor-content]").click();
	await page.keyboard.press(`${MODIFIER}+j`);

	await expect(
		page.locator("[data-pen-ai-inline-session-input]"),
	).toBeVisible();
});

test("opens the inline AI prompt from the toolbar", async ({ page }) => {
	await openPlayground(page);

	await page.getByRole("button", { name: "Ask AI" }).click();

	const session = page.locator("[data-pen-ai-inline-session]");
	const input = session.locator("[data-pen-ai-inline-session-input]");
	await expect(input).toBeVisible();
	await expect(session.getByRole("button", { name: "Send" })).toBeVisible();
	await expect(session.getByRole("button", { name: "Send" })).toBeDisabled();

	await input.fill("hello");
	await expect(session.getByRole("button", { name: "Send" })).toBeEnabled();
});

test("inserts the inline prompt before the current block", async ({ page }) => {
	await openPlayground(page);

	await page.locator("[data-pen-editor-content]").click();
	await page.keyboard.press(`${MODIFIER}+j`);

	const session = page.locator("[data-pen-ai-inline-session]");
	await expect(session).toBeVisible();

	const placement = await session.evaluate((el) => {
		const host = el.parentElement;
		const next = host?.nextElementSibling;
		return {
			inContent: Boolean(el.closest("[data-pen-editor-content]")),
			nextIsBlock: Boolean(next?.hasAttribute("data-pen-editor-block")),
			position: getComputedStyle(el).position,
		};
	});
	expect(placement.inContent).toBe(true);
	expect(placement.nextIsBlock).toBe(true);
	expect(placement.position).toBe("relative");
});

test("keeps focus in the inline prompt while typing", async ({ page }) => {
	await openPlayground(page);

	await page.locator("[data-pen-editor-content]").click();
	await page.keyboard.press(`${MODIFIER}+j`);

	const input = page.locator("[data-pen-ai-inline-session-input]");
	await expect(input).toBeVisible();
	await input.pressSequentially("hello");

	await expect(input).toHaveValue("hello");
	await expect(input).toBeFocused();
	await expect(page.locator("[data-pen-editor-content]")).toContainText(
		"Pen playground",
	);
});
