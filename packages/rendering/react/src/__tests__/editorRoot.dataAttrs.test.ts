// @vitest-environment jsdom

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { EditorRoot } from "../primitives/editor/root";
import {
	buildDataAttributes,
	DATA_ATTRS,
} from "@input/pen-dom/utils/dataAttributes";
import { cleanupEditor, createEditor } from "./utils/editorRootTestHelpers";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = new Set<string>(Object.values(DATA_ATTRS));

function listProductionSources(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__") continue;
			files.push(...listProductionSources(path));
			continue;
		}
		if (
			(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
			!entry.name.endsWith(".test.ts") &&
			!entry.name.endsWith(".test.tsx")
		) {
			files.push(path);
		}
	}
	return files;
}

function emittedNamesFromSource(source: string): string[] {
	const names: string[] = [];
	let from = 0;
	while (true) {
		const start = source.indexOf("buildDataAttributes({", from);
		if (start === -1) break;
		const open = source.indexOf("{", start);
		let depth = 0;
		let close = open;
		for (let i = open; i < source.length; i++) {
			if (source[i] === "{") depth += 1;
			else if (source[i] === "}") {
				depth -= 1;
				if (depth === 0) {
					close = i;
					break;
				}
			}
		}
		const body = source.slice(open + 1, close);
		let resolvedAny = false;
		for (const line of body.split("\n")) {
			const trimmed = line.trim().replace(/,$/, "");
			if (!trimmed) continue;
			const computed = /^\[DATA_ATTRS\.(\w+)\]/.exec(trimmed);
			if (computed) {
				const value =
					DATA_ATTRS[computed[1] as keyof typeof DATA_ATTRS];
				if (typeof value !== "string") {
					throw new Error(
						`DATA_ATTRS.${computed[1]} is not in the catalog`,
					);
				}
				names.push(value);
				resolvedAny = true;
				continue;
			}
			const quoted = /^["']([^"']+)["']/.exec(trimmed);
			if (quoted) {
				names.push(
					quoted[1].startsWith("data-")
						? quoted[1]
						: `data-${quoted[1]}`,
				);
				resolvedAny = true;
				continue;
			}
			const ident = /^([A-Za-z_$][\w$]*)/.exec(trimmed);
			if (ident) {
				names.push(`data-${ident[1]}`);
				resolvedAny = true;
			}
		}
		if (!resolvedAny) {
			throw new Error(`unreadable buildDataAttributes call: ${body}`);
		}
		from = close;
	}
	return names;
}

describe("editor root data-attribute catalog pin", () => {
	it("every name this package emits through buildDataAttributes is a DATA_ATTRS value", () => {
		const unknown: string[] = [];
		let calls = 0;
		for (const file of listProductionSources(SRC_ROOT)) {
			const source = readFileSync(file, "utf8");
			if (!source.includes("buildDataAttributes({")) continue;
			const names = emittedNamesFromSource(source);
			calls += 1;
			for (const name of names) {
				if (!CATALOG.has(name)) unknown.push(`${file}: ${name}`);
			}
		}
		expect(calls).toBeGreaterThan(0);
		expect(unknown).toEqual([]);
	});
});

async function renderRoot(
	editor: ReturnType<typeof createEditor>,
	readonly?: boolean,
): Promise<{ container: HTMLDivElement; root: Root; host: HTMLElement }> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const reactRoot = createRoot(container);

	await act(async () => {
		reactRoot.render(React.createElement(EditorRoot, { editor, readonly }));
	});

	const host = container.querySelector("[data-pen-editor-root]");
	if (!(host instanceof HTMLElement)) {
		throw new Error("Missing editor root host");
	}
	return { container, root: reactRoot, host };
}

describe("HOST6 boolean data-attribute form", () => {
	it("HOST6: true is valueless and false is omitted", () => {
		expect(
			buildDataAttributes({
				[DATA_ATTRS.readonly]: true,
				[DATA_ATTRS.empty]: false,
				[DATA_ATTRS.focused]: undefined,
			}),
		).toEqual({
			[DATA_ATTRS.readonly]: "",
		});
		expect(
			Object.keys(
				buildDataAttributes({
					[DATA_ATTRS.readonly]: false,
				}),
			),
		).toEqual([]);
	});

	it('HOST6: rendered root matches [data-readonly] and not [data-readonly="true"]', async () => {
		const editor = createEditor();
		const { container, root, host } = await renderRoot(editor, true);

		expect(host.getAttribute("data-readonly")).toBe("");
		expect(host.matches("[data-readonly]")).toBe(true);
		expect(host.matches('[data-readonly=""]')).toBe(true);
		expect(host.matches('[data-readonly="true"]')).toBe(false);
		expect(host.matches('[data-readonly="false"]')).toBe(false);
		expect(host.getAttribute("aria-readonly")).toBe("true");

		await cleanupEditor(editor, root, container);
	});

	it("HOST6: false boolean is absent so [data-readonly] does not match", async () => {
		const editor = createEditor();
		const { container, root, host } = await renderRoot(editor);

		expect(host.hasAttribute("data-readonly")).toBe(false);
		expect(host.matches("[data-readonly]")).toBe(false);
		expect(host.matches('[data-readonly="false"]')).toBe(false);
		expect(host.hasAttribute("aria-readonly")).toBe(false);

		await cleanupEditor(editor, root, container);
	});
});
