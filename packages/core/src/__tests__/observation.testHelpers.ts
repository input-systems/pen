export type TestYTextLike = {
	insert(offset: number, text: string): void;
};

export type TestRawDocLike = {
	transact(fn: () => void, origin?: unknown): void;
	getMap(name: "blocks"): {
		get(
			blockId: string,
		): { get(key: "content"): TestYTextLike } | undefined;
	};
};

export function ownKeys(value: object): string[] {
	return Object.keys(value).sort();
}
