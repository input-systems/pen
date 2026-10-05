// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ANNOUNCE_RATE_LIMIT_MS,
	createAnnouncer,
	type Announcer,
} from "../announcer";

const announcers: Announcer[] = [];

afterEach(() => {
	for (const announcer of announcers) {
		announcer.dispose();
	}
	announcers.length = 0;
	document.body.replaceChildren();
	vi.useRealTimers();
});

function mount(root?: ParentNode): Announcer {
	const announcer = createAnnouncer({ root });
	announcers.push(announcer);
	return announcer;
}

/** An announcer whose writes queue as jobs the test runs by hand. */
function queued(options: { root?: ParentNode; now?: () => number } = {}) {
	const jobs: Array<() => void> = [];
	const announcer = createAnnouncer({ ...options, schedule: (write) => jobs.push(write) });
	announcers.push(announcer);
	return { announcer, jobs };
}

function liveRegion(container: ParentNode = document.body): HTMLElement | null {
	return container.querySelector('[role="status"]');
}

describe("createAnnouncer (AX2)", () => {
	it("AX2: mounts one live region with role=status, aria-live=polite, aria-atomic=true", () => {
		mount();

		const region = liveRegion();
		expect(region).not.toBeNull();
		expect(region?.getAttribute("role")).toBe("status");
		expect(region?.getAttribute("aria-live")).toBe("polite");
		// ARIA boolean: literal "true". `aria-atomic=""` is invalid.
		expect(region?.getAttribute("aria-atomic")).toBe("true");
		expect(document.body.querySelectorAll('[role="status"]').length).toBe(
			1,
		);
	});

	it("AX2: live region is visually hidden", () => {
		mount();

		const region = liveRegion();
		expect(region?.style.position).toBe("absolute");
		expect(region?.style.width).toBe("1px");
		expect(region?.style.height).toBe("1px");
		expect(region?.style.overflow).toBe("hidden");
		expect(region?.style.clip).toMatch(/^rect\(/);
		expect(region?.style.whiteSpace).toBe("nowrap");
	});

	it("AX2: announce writes the message into the live region", () => {
		const announcer = mount();
		announcer.announce("Converted to heading");

		expect(liveRegion()?.textContent).toBe("Converted to heading");
	});

	it("AX2: assertive priority sets aria-live=assertive", () => {
		const announcer = mount();
		announcer.announce("Urgent", "assertive");

		expect(liveRegion()?.getAttribute("aria-live")).toBe("assertive");
		expect(liveRegion()?.textContent).toBe("Urgent");
	});

	it("AX2: rate-limits one announcement per key per 500ms", () => {
		vi.useFakeTimers();
		const announcer = mount();

		announcer.announce(
			"3 blocks selected",
			"polite",
			"blockSelectionChanged",
		);
		announcer.announce(
			"4 blocks selected",
			"polite",
			"blockSelectionChanged",
		);

		expect(liveRegion()?.textContent).toBe("3 blocks selected");

		vi.advanceTimersByTime(ANNOUNCE_RATE_LIMIT_MS - 1);
		expect(liveRegion()?.textContent).toBe("3 blocks selected");
	});

	it("AX2: latest announcement wins when the same key repeats inside the window", () => {
		vi.useFakeTimers();
		const announcer = mount();

		announcer.announce(
			"3 blocks selected",
			"polite",
			"blockSelectionChanged",
		);
		announcer.announce(
			"4 blocks selected",
			"polite",
			"blockSelectionChanged",
		);
		announcer.announce(
			"5 blocks selected",
			"polite",
			"blockSelectionChanged",
		);

		expect(liveRegion()?.textContent).toBe("3 blocks selected");

		vi.advanceTimersByTime(ANNOUNCE_RATE_LIMIT_MS);
		expect(liveRegion()?.textContent).toBe("5 blocks selected");
	});

	it("AX2: different keys are not rate-limited against each other", () => {
		const announcer = mount();

		announcer.announce("Streaming started", "polite", "streamingStarted");
		announcer.announce(
			"2 blocks selected",
			"polite",
			"blockSelectionChanged",
		);

		expect(liveRegion()?.textContent).toBe("2 blocks selected");
	});

	it("AX2: a key may announce again after 500ms", () => {
		vi.useFakeTimers();
		const announcer = mount();

		announcer.announce("first", "polite", "streamingStarted");
		vi.advanceTimersByTime(ANNOUNCE_RATE_LIMIT_MS);
		announcer.announce("second", "polite", "streamingStarted");

		expect(liveRegion()?.textContent).toBe("second");
	});

	it("AX2: optional root mounts the region on that parent", () => {
		const root = document.createElement("div");
		document.body.appendChild(root);

		mount(root);

		expect(liveRegion(root)).not.toBeNull();
		expect(liveRegion(document.body)).toBe(liveRegion(root));
		expect(root.querySelectorAll('[role="status"]').length).toBe(1);
	});

	it("AX2: dispose removes the live region and pending announcements", () => {
		vi.useFakeTimers();
		const announcer = mount();

		announcer.announce(
			"3 blocks selected",
			"polite",
			"blockSelectionChanged",
		);
		announcer.announce(
			"4 blocks selected",
			"polite",
			"blockSelectionChanged",
		);
		announcer.dispose();

		expect(liveRegion()).toBeNull();

		vi.advanceTimersByTime(ANNOUNCE_RATE_LIMIT_MS);
		expect(liveRegion()).toBeNull();
	});

	it("AX2: announce after dispose is a no-op", () => {
		const announcer = mount();
		announcer.dispose();
		announcer.announce("too late");

		expect(liveRegion()).toBeNull();
	});

	it("AX2: an injected schedule receives one write job per announcement and the region is untouched until it runs", () => {
		const { announcer, jobs } = queued();
		const region = liveRegion()!;

		announcer.announce("Converted to Heading", "assertive");

		expect(jobs).toHaveLength(1);
		expect(region.textContent).toBe("");
		expect(region.getAttribute("aria-live")).toBe("polite");
		jobs[0]!();
		expect(region.textContent).toBe("Converted to Heading");
		expect(region.getAttribute("aria-live")).toBe("assertive");
	});

	it("AX2: the rate limit is stamped at queue time", () => {
		vi.useFakeTimers();
		let clock = 1_000;
		const { announcer, jobs } = queued({ now: () => clock });

		announcer.announce("first", "polite", "key");
		clock += 100;
		// The first job has not run yet; the window opened when it was queued.
		announcer.announce("second", "polite", "key");

		expect(jobs).toHaveLength(1);
		for (const job of jobs.splice(0)) job();
		expect(liveRegion()!.textContent).toBe("first");
		clock += ANNOUNCE_RATE_LIMIT_MS;
		vi.advanceTimersByTime(ANNOUNCE_RATE_LIMIT_MS);
		expect(jobs).toHaveLength(1);
		jobs[0]!();
		expect(liveRegion()!.textContent).toBe("second");
	});

	it("AX2: a disposed announcer drops queued writes", () => {
		const root = document.body.appendChild(document.createElement("div"));
		const { announcer, jobs } = queued({ root });
		const region = liveRegion(root)!;

		announcer.announce("queued");
		announcer.dispose();
		for (const job of jobs) job();

		expect(region.textContent).toBe("");
		expect(liveRegion(root)).toBeNull();
	});
});
