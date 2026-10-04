export const PASTE_CORPUS_SYNTHETIC_PROVENANCE = "synthetic-until-capture" as const;

/**
 * Synthetic fixtures stay small. A real Word clipboard dump is hundreds
 * of kilobytes; if a payload this large is still labelled synthetic, the
 * capture landed without provenance.
 */
export const PASTE_CORPUS_SYNTHETIC_SIZE_CEILING = 8_192;

export const PASTE_CORPUS_SOURCE_IDS = [
  "word-desktop",
  "word-web",
  "google-docs",
  "apple-notes",
  "notion",
  "slack",
  "vscode",
  "article",
  "excel-sheets",
  "pen",
] as const;

export type PasteCorpusSourceId = (typeof PASTE_CORPUS_SOURCE_IDS)[number];

/**
 * A hand-captured clipboard dump. Drop this in by overwriting
 * `clipboard.html` / `plain.txt` and replacing the synthetic provenance
 * string with this object. See `CAPTURE.md` in this directory.
 */
export type PasteCorpusCaptureProvenance = {
  readonly kind: "captured";
  readonly application: string;
  readonly version: string;
  readonly capturedAt: string;
  readonly host?: string;
};

export type PasteCorpusProvenance =
  | typeof PASTE_CORPUS_SYNTHETIC_PROVENANCE
  | PasteCorpusCaptureProvenance;

export type PasteCorpusMarkExpectation = {
  type: string;
  text: string;
};

export type PasteCorpusBlockExpectation = {
  type: string;
  text?: string;
  level?: number;
  indent?: number;
  language?: string;
  checked?: boolean;
  rows?: number;
  cols?: number;
  hasHeaderRow?: boolean;
  cells?: string[][];
  marks?: PasteCorpusMarkExpectation[];
};

export type PasteCorpusOutcomes = {
  headings: string;
  lists: string;
  tables: string;
  code: string;
  links: string;
  images: string;
  marks: string;
  colors: string;
};

export type PasteCorpusExpectation = {
  id: PasteCorpusSourceId;
  source: string;
  provenance: PasteCorpusProvenance;
  approximates: string;
  markers: string[];
  imageCount: number;
  outcomes: PasteCorpusOutcomes;
  intentionalLosses: string[];
  blocks: PasteCorpusBlockExpectation[];
};

export type PasteCorpusFixture = {
  id: PasteCorpusSourceId;
  html: string;
  plain: string;
  expectation: PasteCorpusExpectation;
};
