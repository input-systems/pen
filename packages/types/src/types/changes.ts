/**
 * Which side of a position inserted text lands on. `-1` sticks to the
 * character before the position, `1` to the character after — so a caret with
 * `assoc: -1` stays put when text is inserted at its offset, and one with
 * `assoc: 1` is pushed along by it.
 *
 * This is the single declaration; `@input/pen-types/anchors` re-exports it.
 */
export type Assoc = -1 | 1;

export type DefaultAssoc = 1;

export interface Point {
	readonly blockId: string;
	readonly offset: number;
}

export interface TextSplice {
	readonly from: number;
	readonly to: number;
	readonly insertLength: number;
}

export interface BlockTextChange {
	readonly blockId: string;
	readonly splices: readonly TextSplice[];
	readonly formatRanges: readonly { from: number; to: number }[];
}

export type StructuralChange =
	| {
			readonly type: "block-inserted";
			readonly blockId: string;
			readonly parentId: string | null;
			readonly index: number;
	  }
	| {
			readonly type: "block-removed";
			readonly blockId: string;
			readonly parentId: string | null;
			readonly index: number;
	  }
	| {
			readonly type: "block-moved";
			readonly blockId: string;
			readonly fromParentId: string | null;
			readonly fromIndex: number;
			readonly toParentId: string | null;
			readonly toIndex: number;
	  }
	| {
			readonly type: "block-props-changed";
			readonly blockId: string;
			readonly keys: readonly string[];
	  }
	| {
			readonly type: "block-split";
			readonly blockId: string;
			readonly newBlockId: string;
			readonly offset: number;
	  }
	| {
			readonly type: "blocks-merged";
			readonly targetBlockId: string;
			readonly sourceBlockId: string;
			readonly joinOffset: number;
			/**
			 * Where the source sat before the merge — its parent's array (`null`
			 * for the root order) and pre-commit index, as `block-removed`
			 * reports them. The merge names no `block-removed` for its source,
			 * so this is the only record of the position it vacated. Absent
			 * when the commit removed no array entry for the source.
			 */
			readonly sourceParentId?: string | null;
			readonly sourceIndex?: number;
	  }
	| { readonly type: "table-changed"; readonly blockId: string }
	| { readonly type: "apps-changed"; readonly appIds: readonly string[] }
	| {
			readonly type: "metadata-changed";
			readonly namespaces: readonly string[];
	  };

export interface ChangeSummary {
	readonly commitId: number;
	readonly blockText: readonly BlockTextChange[];
	readonly structural: readonly StructuralChange[];
	readonly affectedBlockIds: readonly string[];
}
