
export type Decoration =
  | InlineDecoration
  | BlockDecoration
  | AppDecoration;

export interface InlineDecoration {
  type: "inline";
  blockId: string;
  from: number;
  to: number;
  attributes: Record<string, string | number | boolean>;
  virtualText?: string;
  virtualPlacement?: "before" | "after";
  /** When true, decorated text is omitted from rendered output (e.g. hidden delete ranges). */
  omitFromRender?: boolean;
  key?: string;
}

/** Generic decoration attribute written when {@link InlineDecoration.omitFromRender} is true. */
export const DECORATION_OMIT_FROM_RENDER_ATTRIBUTE = "data-pen-omit-from-render";

export interface BlockDecoration {
  type: "block";
  blockId: string;
  attributes: Record<string, string | number | boolean>;
  position?: "before" | "after" | "wrap";
}

export interface AppDecoration {
  type: "app";
  blockId: string;
  offset: number;
  component: unknown;
  key: string;
}

export interface DecorationSet {
  readonly decorations: readonly Decoration[];
  readonly generation: number;

  forBlock(blockId: string): readonly Decoration[];
  inlineForBlock(blockId: string): readonly InlineDecoration[];

  equals(other: DecorationSet): boolean;
}
