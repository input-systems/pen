import type {
	CRDTArray,
	CRDTMap,
	Editor,
	PenDocument,
} from "@input/pen-types";

type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

/**
 * Nested document order: each `blockOrder` root, then that block's `children`
 * array. Reads `DocumentState`'s cached preorder, so it is O(1) between
 * structural changes (SCALE2).
 */
export function documentPreorderBlockIds(editor: Editor): readonly string[] {
	return editor.documentState.preorderBlockIds();
}

export function documentPreorderBlockIdsFromDoc(doc: PenDocument): string[] {
	const ids: string[] = [];
	const seen = new Set<string>();
	const blocks = doc.blocks as CRDTBlockMap;
	const order = doc.blockOrder as CRDTArray<string>;

	const walk = (id: string) => {
		if (seen.has(id)) {
			return;
		}
		seen.add(id);
		ids.push(id);
		const blockMap = blocks.get(id);
		const children = blockMap?.get("children") as
			| CRDTArray<string>
			| undefined;
		if (!children) {
			return;
		}
		for (let i = 0; i < children.length; i++) {
			walk(children.get(i));
		}
	};

	for (let i = 0; i < order.length; i++) {
		walk(order.get(i));
	}
	return ids;
}
