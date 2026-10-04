import { createEditor as createCoreEditor } from "../index";
import { createDefaultSchema } from "./fixtures/testSchema";
import type { PenStreamPart } from "@input/pen-types";

export const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

export function createEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
) {
	return createCoreEditor({
		schema: createDefaultSchema(),
		...options,
		preset: options.preset ?? noDefaultExtensionsPreset,
	});
}

export function createDefaultEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
) {
	return createCoreEditor({
		schema: createDefaultSchema(),
		...options,
	});
}

export async function* createStream(parts: PenStreamPart[]) {
	for (const part of parts) {
		yield part;
	}
}

export async function flushMicrotasks(count = 2): Promise<void> {
	for (let index = 0; index < count; index++) {
		await Promise.resolve();
	}
}

export type TestYTextLike = {
	insert(offset: number, text: string): void;
};

export type TestBlockMapLike = {
	get(key: string): unknown;
};

export type TestBlocksMapLike = {
	get(key: string): TestBlockMapLike | undefined;
};

export type TestRawDocLike = {
	getMap(name: "blocks"): TestBlocksMapLike;
};

export type TestTableRowLike = {
	get(field: "cells"): { delete(index: number, length: number): void };
};

export type TestTableContentLike = {
	get(index: number): TestTableRowLike;
};
