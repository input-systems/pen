import type { Block, AppPlacement, Range } from "./block";
import type {
  HTMLImportElement,
  MarkdownNode,
  XMLElement,
} from "./serialization";
import type { LayoutSchema } from "./layout";
import type { KeyBinding } from "./input";
import type { SelectionState } from "./selection";
import type { BlockA11ySpec } from "./a11y";

// ── Prop Schema (JSON Schema subset) ────────────────────────

export type PropSchema = {
  type?: string | string[];
  default?: unknown;
  enum?: unknown[];
  description?: string;
  properties?: Record<string, PropSchema>;
  items?: PropSchema;
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
};

// ── Content type ────────────────────────────────────────────

export type ContentType =
  | "inline"
  | "none"
  | "table"
  | "subdocument"
  | BlockSchema[];

export function isNestedContent(content: ContentType): content is BlockSchema[] {
  return Array.isArray(content);
}

// ── Block Display ───────────────────────────────────────────

export interface BlockDisplay {
  title: string;
  description?: string;
  icon?: string;
  group?: string;
  aliases?: string[];
  hidden?: boolean;
}

export interface ImportInlineMark {
  type: string;
  props?: Record<string, unknown>;
  start: number;
  end: number;
}

export interface ImportContentSource {
  markdownNodes?: MarkdownNode[];
  markdownHtml?: string;
  htmlElement?: HTMLImportElement;
}

export interface BlockImportMatch<
  Type extends string = string,
  Props extends Record<string, unknown> = Record<string, unknown>,
> {
  type: Type;
  props: Props;
  content?: string;
  marks?: ImportInlineMark[];
  children?: BlockImportMatch[];
  importContentSource?: ImportContentSource;
}

// ── Block Schema ────────────────────────────────────────────

type InferProps<P extends Record<string, PropSchema>> = {
  [K in keyof P]: unknown;
};

export type FieldEditorType =
  | "richtext"
  | "plaintext"
  | "code"
  | "table"
  | "subdocument"
  | "none";

export type FlowBlockCapability =
  | "flow-inline"
  | "flow-structural"
  | "flow-delegated"
  | "flow-disallowed";

export type BlockSelectionRole = "editable-inline" | "structural" | "delegated";

export type BlockContentRole = "content" | "chrome";

export interface BlockAuthoring {
  flowCapability?: FlowBlockCapability;
  selectionRole?: BlockSelectionRole;
  contentRole?: BlockContentRole;
}

export interface BlockSchema<
  Type extends string = string,
  Props extends Record<string, PropSchema> = Record<string, PropSchema>,
  Content extends ContentType = ContentType,
> {
  type: Type;
  propSchema: Props;
  content: Content;
  layout?: LayoutSchema;

  serialize: {
    toMarkdown?(this: void, block: Block<Type, InferProps<Props>>): string;
    fromMarkdown?(
      this: void,
      node: MarkdownNode,
    ): BlockImportMatch<Type, InferProps<Props>> | null;
    toHTML?(this: void, block: Block<Type, InferProps<Props>>): string;
    fromHTML?(
      this: void,
      element: HTMLImportElement,
    ): BlockImportMatch<Type, InferProps<Props>> | null;
    toXML?(this: void, block: Block<Type, InferProps<Props>>): string;
    fromXML?(
      this: void,
      element: XMLElement,
    ): Block<Type, InferProps<Props>> | null;
  };

  normalize?(
    this: void,
    block: Block<Type, InferProps<Props>>,
  ): Block<Type, InferProps<Props>>;
  validateProps?(this: void, raw: Record<string, unknown>): InferProps<Props>;
  fieldEditor?: FieldEditorType;
  keyBindings?: readonly KeyBinding[];
  placeholder?: string;
  display?: BlockDisplay;
  authoring?: BlockAuthoring;
  isContainer?: boolean;
  aiDescription?: string;
  a11y?: BlockA11ySpec<InferProps<Props>>;
}

// ── Inline Schema ───────────────────────────────────────────

export interface InlineSchema<
  Type extends string = string,
  Props extends Record<string, PropSchema> = Record<string, PropSchema>,
> {
  type: Type;
  propSchema: Props;
  kind: "mark" | "node";

  serialize: {
    toMarkdown?: (text: string, props: Record<string, unknown>) => string;
    fromMarkdown?: (node: MarkdownNode) => Record<string, unknown> | null;
    toHTML?: (text: string, props: Record<string, unknown>) => string;
    toXML?: (text: string, props: Record<string, unknown>) => string;
    /** Plain-text interchange for inline atoms (`kind: "node"`). Marks ignore this. */
    toText?: (props: Record<string, unknown>) => string;
  };

  apply?(content: unknown, range: Range, value: unknown): void;
  remove?(content: unknown, range: Range): void;
  query?(content: unknown, index: number): unknown | null;

  priority?: number;
  expand?: "after" | "before" | "both" | "none";
  system?: boolean;
  aiDescription?: string;
  a11y?: BlockA11ySpec<InferProps<Props>>;
}

// ── App Schema ──────────────────────────────────────────────

export interface AppSchema<
  Type extends string = string,
  Config extends Record<string, PropSchema> = Record<string, PropSchema>,
> {
  type: Type;
  configSchema: Config;
  defaultPlacement: AppPlacement["mode"];
  allowedPlacements: AppPlacement["mode"][];
  onAnchorDeleted?: "delete" | "orphan";
  isolation?: "none" | "error-boundary" | "iframe";

  serialize: {
    toMarkdown?: (app: import("./block").App<Type>) => string;
    toHTML?: (app: import("./block").App<Type>) => string;
    toXML?: (app: import("./block").App<Type>) => string;
  };

  aiDescription?: string;
}

// ── Schema Registry ─────────────────────────────────────────

export interface SchemaRegistry {
  resolve(type: string): BlockSchema | null;
  resolveInline(type: string): InlineSchema | null;
  resolveApp(type: string): AppSchema | null;
  resolveLayout(type: string): LayoutSchema | null;

  allBlocks(): readonly BlockSchema[];
  allInlines(): readonly InlineSchema[];
  allApps(): readonly AppSchema[];
  allBlockDisplays(): readonly (BlockSchema & { display: BlockDisplay })[];

  onUnknownBlock?: (
    type: string,
    raw: unknown,
  ) => BlockSchema | "drop" | "passthrough";

  onUnknownInline?: (
    type: string,
    raw: unknown,
  ) => InlineSchema | "drop" | "passthrough";
}

// ── Composable Schema ───────────────────────────────────────

export interface ComposableSchema extends SchemaRegistry {
  extend(schemas: readonly (BlockSchema | InlineSchema)[]): ComposableSchema;
  without(types: readonly string[]): ComposableSchema;
  override(type: string, overrides: Partial<BlockSchema>): ComposableSchema;
  overrideSystemMark(type: string, schema: InlineSchema): ComposableSchema;
}

export type { LayoutSchema };
