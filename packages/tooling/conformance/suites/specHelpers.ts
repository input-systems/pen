import type {
	DocumentContentSnapshot,
	GeometryLineBox,
	SerializedSelection,
} from "../src/types";
import { expect, type Page, test } from "@playwright/test";
import { getInlineOffsetPoint } from "../src/domGeometry";
import { loadavg } from "node:os";

export function snapshotBytes(snapshot: DocumentContentSnapshot): string {
	return JSON.stringify(snapshot);
}

export function collectPageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("pageerror", (error) => {
		errors.push(error.message);
	});
	return errors;
}

export async function clickOffset(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	const point = await getInlineOffsetPoint(page, { blockId, offset });
	await page.mouse.click(point.x, point.y);
}

/**
 * Clicks a logical offset and waits until the authority holds a collapsed
 * text caret there.
 */
export async function clickOffsetAndAwaitCaret(
	page: Page,
	blockId: string,
	offset: number,
): Promise<void> {
	await clickOffset(page, blockId, offset);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const selection = window.__penConformance.selection;
				if (selection?.type !== "text") {
					return "not-text";
				}
				if (!window.__penConformance.isCollapsed()) {
					return "expanded";
				}
				return `${selection.focus.blockId}:${selection.focus.offset}`;
			}),
		)
		.toBe(`${blockId}:${offset}`);
}

/** The model text of one block (the authority, not the DOM). */
export async function readModelBlockText(
	page: Page,
	blockId: string,
): Promise<string> {
	return page.evaluate((id) => window.__penConformance.blockText(id), blockId);
}

export async function blockInlineText(
	page: Page,
	blockId: string,
): Promise<string> {
	return page.evaluate((id) => {
		const block = document.querySelector(`[data-block-id="${id}"]`);
		const inline = block?.querySelector("[data-pen-inline-content]");
		return inline?.textContent ?? "";
	}, blockId);
}

export type Focus = { blockId: string; offset: number } | null;

export async function readFocus(page: Page): Promise<Focus> {
	return page.evaluate(() => {
		const selection = window.__penConformance.selection;
		if (selection?.type !== "text") {
			return null;
		}
		return {
			blockId: selection.focus.blockId,
			offset: selection.focus.offset,
		};
	});
}

export function midpoint(line: GeometryLineBox): number {
	if (line.endOffset <= line.startOffset) {
		return line.startOffset;
	}
	return (
		line.startOffset + Math.floor((line.endOffset - line.startOffset) / 2)
	);
}

export function logLoad(label: string): number[] {
	const loads = loadavg();
	console.log(`${label} loadavg ${loads.join(" ")}`);
	return loads;
}

export async function attachJson(
	name: string,
	payload: unknown,
): Promise<void> {
	await test.info().attach(name, {
		body: JSON.stringify({ loadavg: loadavg(), payload }, null, 2),
		contentType: "application/json",
	});
}

export type FocusPoint = { blockId: string; offset: number } | null;

export async function readBlockIds(page: Page): Promise<string[]> {
	return page.evaluate(() => [...window.__penConformance.blockIds]);
}

export async function readSelection(page: Page): Promise<SerializedSelection> {
	return page.evaluate(() => window.__penConformance.selection);
}

export function attachLoadavg(label: string, payload: unknown): Promise<void> {
	const loads = loadavg();
	console.log(`${label} loadavg ${loads.join(" ")}`);
	return test.info().attach(label, {
		body: JSON.stringify({ loadavg: loads, payload }, null, 2),
		contentType: "application/json",
	});
}
