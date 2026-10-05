import { expect, type Page } from "@playwright/test";
import { analyzeEditorSurface, formatAxeViolations } from "../src/axeSurface";
import { FIXTURE_NAMES } from "../fixtures/catalog";
import { scenario } from "../src/scenario";

async function expectNoAxeViolations(page: Page): Promise<void> {
	const { violations } = await analyzeEditorSurface(page);
	expect(violations, formatAxeViolations(violations)).toEqual([]);
}

for (const fixture of FIXTURE_NAMES) {
	scenario(`AX1: axe surface semantics on ${fixture}`, async (s, page) => {
		await s.load(fixture);
		await expectNoAxeViolations(page);
	});
}

/** The committed AX1 tree for the `semantics` fixture (W6 §6.2), React surface. */
const SEMANTICS_ARIA_SNAPSHOT = `
- textbox "Editor":
  - heading "Semantics" [level=1]
  - heading "Lists" [level=2]
  - list:
    - listitem [level=1]: First bullet
    - listitem [level=2]: Nested bullet
    - listitem [level=1]: Second bullet
  - list:
    - listitem [level=1]: Second list bullet
  - list:
    - listitem [level=1]: Third
    - listitem [level=1]: Fourth
  - heading "Other blocks" [level=3]
  - list:
    - listitem [level=1]:
      - checkbox [checked]
      - text: Done
    - listitem [level=1]:
      - checkbox
      - text: Open
  - blockquote: A quote Quoted child
  - code: const answer = 42;
  - note: A callout
  - table:
    - rowgroup:
      - row:
        - columnheader "Heading 1"
        - columnheader "Heading 2"
        - columnheader "Heading 3"
    - rowgroup:
      - row:
        - cell "r1c0"
        - cell "r1c1"
        - cell "r1c2"
      - row:
        - cell "r2c0"
        - cell "r2c1"
        - cell "r2c2"
`;

/** Every list item's role, level, position and set size, in document order. */
async function listItemSequence(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.querySelectorAll("[data-pen-list-group] > [data-pen-editor-block]")].map(
			(item) =>
				[
					item.parentElement?.getAttribute("role"),
					item.getAttribute("role"),
					item.getAttribute("aria-level"),
					item.getAttribute("aria-posinset"),
					item.getAttribute("aria-setsize"),
				].join(":"),
		),
	);
}

scenario(
	"AX1: the semantics fixture exposes headings, two bullet lists, a numbered list, a table with column headers, a quote and code in the accessibility tree",
	async (s, page) => {
		await s.load("semantics");
		await expect(page.locator("[data-pen-editor-root]")).toMatchAriaSnapshot(
			SEMANTICS_ARIA_SNAPSHOT,
		);
		// D7: div groups only; positions on the block host, never on the item layout (HB8).
		await expect(page.locator("[data-pen-editor-root] :is(ul, ol, li)")).toHaveCount(0);
		await expect(
			page.locator("[data-pen-list-item-layout]:is([role], [aria-posinset], [aria-setsize], [aria-level])"),
		).toHaveCount(0);
	},
);

for (const surface of ["vue", "vanilla"] as const) {
	scenario(
		`AX1: ${surface} exposes the same list semantics as React for the semantics fixture`,
		async (s, page) => {
			await s.load("semantics");
			expect(await listItemSequence(page)).toEqual([
				"list:listitem:1:1:2",
				"list:listitem:2:1:1",
				"list:listitem:1:2:2",
				"list:listitem:1:1:1",
				"list:listitem:1:1:2",
				"list:listitem:1:2:2",
				"list:listitem:1:1:2",
				"list:listitem:1:2:2",
			]);
			await expectNoAxeViolations(page);
		},
		{ url: `/?surface=${surface}` },
	);
}

scenario(
	"AX1: text editing is a single tab stop in both directions",
	async (s, page) => {
		await s.load("two-paragraph");

		const root = page.locator("[data-pen-editor-root]");
		// The neighbour is a text input, not a button: WebKit on macOS follows
		// the platform's "Tab moves between text fields only" default and drops
		// buttons from sequential navigation, so Shift+Tab out of the editor
		// would leave a button-only page with nowhere to land.
		await root.evaluate((rootElement) => {
			const before = document.createElement("input");
			before.setAttribute("data-ax1-before-editor", "");
			before.setAttribute("aria-label", "Before editor");
			rootElement.before(before);
		});
		const before = page.locator("[data-ax1-before-editor]");
		await before.focus();
		await page.keyboard.press("Tab");
		await expect(root.locator("[data-pen-field-editor-active-surface]")).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(before).toBeFocused();
	},
);

scenario(
	"AX1: tabbing back into a block selection focuses its accessible surface",
	async (s, page) => {
		await s.load("two-paragraph");
		await s.apply([
			{
				type: "insert-block",
				blockId: "ax1-divider",
				blockType: "divider",
				props: {},
				position: { after: "two-p1" },
			},
		]);

		await page.locator('[data-block-id="ax1-divider"]').click();
		const root = page.locator("[data-pen-editor-root]");
		const sink = root.locator(":scope > [data-pen-focus-sink]");
		await expect(sink).toHaveAttribute("role", "group");

		await root.evaluate((rootElement) => {
			const before = document.createElement("button");
			before.textContent = "Before editor";
			rootElement.before(before);
			before.focus();
		});
		await expect(root).toHaveAttribute("tabindex", "0");
		await page.keyboard.press("Tab");
		await expect(sink).toBeFocused();
		await expect(root).toHaveAttribute("tabindex", "-1");
	},
);
