import { expect, type Page } from "@playwright/test";
import { scenario } from "../src/scenario";
import type {
	GeometryLineBox,
	GeometryPoint,
	GeometryVerticalMotion,
} from "../src/types";
import {
	G5_ATOMS_BLOCK,
	G5_EMPTY_BLOCK,
	G5_TAIL_BLOCK,
	G5_WRAP_BLOCK,
} from "../src/g5Geometry";
import { midpoint } from "../suites/specHelpers";

async function forceWrap(page: Page): Promise<void> {
	await page.evaluate(() => {
		for (const id of ["g5-wrap", "g5-atoms"]) {
			const block = document.querySelector(`[data-block-id="${id}"]`);
			if (!(block instanceof HTMLElement)) {
				continue;
			}
			block.style.maxWidth = "40px";
			const inline = block.querySelector("[data-pen-inline-content]");
			if (!(inline instanceof HTMLElement)) {
				continue;
			}
			inline.style.display = "block";
			inline.style.width = "40px";
			inline.style.maxWidth = "40px";
			inline.style.font =
				'16px / 20px ui-monospace, "Courier New", Menlo, monospace';
			inline.style.wordBreak = "break-all";
			inline.style.overflowWrap = "anywhere";
		}
	});
}

function lineContaining(
	lines: readonly GeometryLineBox[],
	offset: number,
): GeometryLineBox | undefined {
	return lines.find((line, index) => {
		const last = index === lines.length - 1;
		return (
			offset >= line.startOffset &&
			(offset < line.endOffset || (last && offset <= line.endOffset))
		);
	});
}

function assertDeterministic(result: GeometryVerticalMotion): void {
	expect(
		result.first,
		`G5 ${result.situation}: verticalCaretTarget returned null`,
	).not.toBeNull();
	expect(
		result.second,
		`G5 ${result.situation}: second cached motion was null`,
	).toEqual(result.first);
	expect(
		result.fresh,
		`G5 ${result.situation}: from-scratch motion was null`,
	).toEqual(result.first);
}

scenario(
	"G5: vertical motion across wrapped lines, empty blocks, atoms, and block boundaries lands on identical offsets",
	async (s, page) => {
		await s.load("g5-geometry");
		await forceWrap(page);
		await s.geometry.invalidate();

		await expect
			.poll(
				async () =>
					(await s.geometry.lineBoxes(G5_WRAP_BLOCK)).length,
			)
			.toBeGreaterThanOrEqual(2);

		await s.apply([
			{
				type: "splice-text",
				blockId: G5_ATOMS_BLOCK,
				from: 5,
				to: 5,
				insert: {
					nodeType: "mention",
					props: { id: "user-ada", label: "Ada" },
				},
			},
		]);
		await expect(page.locator("[data-pen-inline-atom]")).toBeVisible();
		await forceWrap(page);
		await s.geometry.invalidate();
		await expect
			.poll(
				async () =>
					(await s.geometry.lineBoxes(G5_ATOMS_BLOCK)).length,
			)
			.toBeGreaterThanOrEqual(2);

		const wrapLines = await s.geometry.lineBoxes(G5_WRAP_BLOCK);
		const firstWrap = wrapLines[0];
		expect(
			firstWrap,
			"G5 wrapped lines: expected at least one line box",
		).toBeTruthy();
		const wrapFrom: GeometryPoint = {
			blockId: G5_WRAP_BLOCK,
			offset: midpoint(firstWrap!),
		};

		const wrapped = await s.geometry.verticalMotion({
			situation: "wrapped-lines",
			from: wrapFrom,
			direction: "down",
		});
		assertDeterministic(wrapped);
		const wrappedLanding = lineContaining(
			wrapLines,
			wrapped.first!.point.offset,
		);
		expect.soft(wrapped.first!.point.blockId).toBe(G5_WRAP_BLOCK);
		expect
			.soft(
				wrappedLanding,
				"G5 wrapped lines: landing offset is outside wrap line boxes",
			)
			.toBeTruthy();
		expect
			.soft(wrappedLanding?.startOffset)
			.toBeGreaterThan(firstWrap!.startOffset);

		const lastWrap = wrapLines[wrapLines.length - 1];
		const empty = await s.geometry.verticalMotion({
			situation: "empty-block",
			from: {
				blockId: G5_WRAP_BLOCK,
				offset: lastWrap?.endOffset ?? wrapFrom.offset,
			},
			direction: "down",
		});
		assertDeterministic(empty);
		expect.soft(empty.first!.point.blockId).toBe(G5_EMPTY_BLOCK);
		expect
			.soft(
				empty.first!.point.offset,
				`G5 empty-block landing ${JSON.stringify(empty.first!.point)}`,
			)
			.toBe(0);

		const atomLines = await s.geometry.lineBoxes(G5_ATOMS_BLOCK);
		const firstAtomLine = atomLines[0];
		expect(firstAtomLine, "G5 atoms: expected a line box").toBeTruthy();
		const atoms = await s.geometry.verticalMotion({
			situation: "atoms",
			from: {
				blockId: G5_ATOMS_BLOCK,
				offset: midpoint(firstAtomLine!),
			},
			direction: "down",
		});
		assertDeterministic(atoms);
		expect.soft(atoms.first!.point.blockId).toBe(G5_ATOMS_BLOCK);
		const atomLanding = lineContaining(
			atomLines,
			atoms.first!.point.offset,
		);
		expect
			.soft(atomLanding?.startOffset)
			.toBeGreaterThan(firstAtomLine!.startOffset);

		const lastAtomLine = atomLines[atomLines.length - 1];
		const boundary = await s.geometry.verticalMotion({
			situation: "block-boundaries",
			from: {
				blockId: G5_ATOMS_BLOCK,
				offset: lastAtomLine?.endOffset ?? 0,
			},
			direction: "down",
		});
		assertDeterministic(boundary);
		expect.soft(boundary.first!.point.blockId).toBe(G5_TAIL_BLOCK);

		const digest = {
			wrapped: wrapped.first!.point,
			empty: empty.first!.point,
			atoms: atoms.first!.point,
			boundary: boundary.first!.point,
		};
		const again = {
			wrapped: (
				await s.geometry.verticalMotion({
					situation: "wrapped-lines",
					from: wrapFrom,
					direction: "down",
					goalX: wrapped.first!.goalX,
				})
			).first!.point,
			empty: (
				await s.geometry.verticalMotion({
					situation: "empty-block",
					from: {
						blockId: G5_WRAP_BLOCK,
						offset: lastWrap?.endOffset ?? wrapFrom.offset,
					},
					direction: "down",
					goalX: empty.first!.goalX,
				})
			).first!.point,
			atoms: (
				await s.geometry.verticalMotion({
					situation: "atoms",
					from: {
						blockId: G5_ATOMS_BLOCK,
						offset: midpoint(firstAtomLine!),
					},
					direction: "down",
					goalX: atoms.first!.goalX,
				})
			).first!.point,
			boundary: (
				await s.geometry.verticalMotion({
					situation: "block-boundaries",
					from: {
						blockId: G5_ATOMS_BLOCK,
						offset: lastAtomLine?.endOffset ?? 0,
					},
					direction: "down",
					goalX: boundary.first!.goalX,
				})
			).first!.point,
		};
		expect(again, "G5: repeating the four motions changed offsets").toEqual(
			digest,
		);
	},
);
