import { expect, type Page } from "@playwright/test";
import { expectCheck } from "../../src/overlayLayer";
import { scenario } from "../../src/scenario";
import { attachJson, clickOffset } from "../specHelpers";

const FIRST_ID = "two-p1";
const LOCAL_OFFSET = 3;
const REMOTE_OFFSET = 1;
const PEER_ID = 71;
const LABEL_GAP_TOKEN = "--pen-peer-label-gap";
const DEFAULT_LABEL_GAP = 8;
const TUNED_LABEL_GAP = 3;

type BindingNode = {
	/** The node's viewport left. */
	left: number;
	top: number;
	/** Where its `translate3d` puts it: the layer origin plus the transform. */
	expectedLeft: number;
	expectedTop: number;
};

type BindingPaint = {
	caret: BindingNode | null;
	remoteCaret: BindingNode | null;
	label: BindingNode | null;
};

/**
 * Each binding-rendered node, with the viewport position its transform
 * names. `left: 0; top: 0` (OV2) makes the two agree; without them an
 * absolutely positioned item takes its static position, which in RTL is the
 * containing block's right edge, one item width to the left.
 */
async function readBindingPaint(page: Page, labelGap: number): Promise<BindingPaint> {
	return page.evaluate((gap) => {
		const layer = document.querySelector("[data-pen-overlay-layer]")!;
		const origin = layer.getBoundingClientRect();
		const read = (selector: string) => {
			const node = layer.querySelector<HTMLElement>(selector);
			if (!node) {
				return null;
			}
			const box = node.getBoundingClientRect();
			// The label's transform also lifts it by its height plus the gap:
			// only compare its translate3d x, and its bottom edge plus the gap.
			const match = /translate3d\(([-\d.e]+)px,\s*([-\d.e]+)px/.exec(
				node.style.transform,
			);
			const x = match ? Number(match[1]) : Number.NaN;
			const y = match ? Number(match[2]) : Number.NaN;
			const lifted = /translateY\(calc\(-100% - /.test(node.style.transform);
			return {
				left: box.left,
				top: lifted ? box.bottom + gap : box.top,
				expectedLeft: origin.left + x,
				expectedTop: origin.top + y,
			};
		};
		return {
			caret: read("[data-conformance-binding-caret]"),
			remoteCaret: read("[data-conformance-binding-remote-caret]"),
			label: read("[data-conformance-binding-label]"),
		};
	}, labelGap);
}

function placed(node: BindingNode | null): boolean {
	return (
		node !== null &&
		Math.abs(node.left - node.expectedLeft) <= 0.25 &&
		Math.abs(node.top - node.expectedTop) <= 0.25
	);
}

scenario(
	"OV2/OV3: in an RTL host, binding-rendered carets and labels sit at their transforms (left and top stay 0)",
	async (s, page) => {
		await s.load("two-paragraph");
		await page.evaluate(() => {
			document.getElementById("root")!.dir = "rtl";
		});
		await expect
			.poll(() => page.evaluate(() => window.__penConformance.hasMultiplayer))
			.toBe(true);

		await clickOffset(page, FIRST_ID, LOCAL_OFFSET);
		const anchor = await page.evaluate(
			({ id, offset }) =>
				window.__penConformance.serializePresenceAnchor(id, offset),
			{ id: FIRST_ID, offset: REMOTE_OFFSET },
		);
		await s.remote.injectPresence([
			{
				clientId: PEER_ID,
				state: {
					user: { id: "u-rtl", name: "Rahel", color: "#0b4f8c" },
					cursor: { anchor, clock: 1 },
				},
			},
		]);
		await expect
			.poll(async () => {
				const paint = await readBindingPaint(page, DEFAULT_LABEL_GAP);
				return [paint.caret, paint.remoteCaret, paint.label].every(Boolean);
			})
			.toBe(true);
		await page.evaluate(() => window.__penConformance.overlayMatchesAuthority());
		const paint = await readBindingPaint(page, DEFAULT_LABEL_GAP);
		await attachJson("ov3-rtl-binding", paint);

		for (const [name, node] of [
			["local caret", paint.caret],
			["remote caret", paint.remoteCaret],
			["remote caret label", paint.label],
		] as const) {
			expectCheck(`OV2: the binding's ${name} sits where its transform puts it`, placed(node), node);
		}

		await page.evaluate(
			([token, gap]) => {
				document.getElementById("root")!.style.setProperty(token, `${gap}px`);
			},
			[LABEL_GAP_TOKEN, TUNED_LABEL_GAP] as const,
		);
		const tuned = (await readBindingPaint(page, TUNED_LABEL_GAP)).label;
		expectCheck(`OV3: ${LABEL_GAP_TOKEN} sets the label's gap above its caret`, placed(tuned), tuned);
	},
	{ url: "/?customCaret=1&bindingCarets=1&col2=1" },
);
