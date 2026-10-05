# @input/pen-interop

## 0.3.0

### Minor Changes

- c921845: Raise `engines.node` from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0` (HOST3). `@input/pen-interop` sanitizes HTML through `isomorphic-dompurify` 4.3, which builds its Node window with jsdom 30, and jsdom 30 declares that range; `@input/pen`, `@input/pen-react`, and `@input/pen-vue` depend on interop, so the workspace-wide floor moves with it. Node 22 releases before 22.22.2, Node 24 releases before 24.15.0, and Node 23 and 25 are no longer supported.

  Breaking: yes — hosts running Node below 22.22.2, 24.0–24.14, or 23/25 must move to a supported Node line (^22.22.2, ^24.15.0 or >=26.0.0)

### Patch Changes

- 56b8dfc: HTML import no longer drops pasted text.

  - Nested lists from Slack, Apple Notes and Google Docs keep every item at the right indent.
  - Block content wrapped in an inline element (Google Docs' outer `<b>`) stays as separate blocks.
  - Table captions and text outside `<code>` in a `<pre>` are kept.
  - A conversion that would still lose text falls back to plain paragraphs or the literal clipboard text.
  - The sanitizer's `isomorphic-dompurify` moves from `~2.36.0` to `~4.3.0`. Its allowlist and output are unchanged (SEC7).

  Breaking: no

- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [c921845]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
- Updated dependencies [56b8dfc]
  - @input/pen-types@0.3.0
  - @input/pen-core@0.3.0
  - @input/pen-ingest@0.3.0
  - @input/pen-markdown@0.3.0

## 0.2.14

### Patch Changes

- b416b6d: Import the inline content of a block container such as `<div>` as one paragraph, keeping its marks and `<br>` line breaks, instead of one paragraph per child with the breaks dropped. A container whose only content is a `<br>` (the Gmail and Apple Mail blank line, `<div><br></div>`) now imports as an empty paragraph, and source formatting whitespace between a container's inline children no longer becomes a line break. A `<br>` that ends any block's content, `<p>` included, no longer imports as a trailing newline, matching how browsers render it.
- @input/pen-core@0.2.14
  - @input/pen-ingest@0.2.14
  - @input/pen-markdown@0.2.14
  - @input/pen-types@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies [8e2654b]
  - @input/pen-core@0.2.13
  - @input/pen-ingest@0.2.13
  - @input/pen-markdown@0.2.13
  - @input/pen-types@0.2.13

## 0.2.12

### Patch Changes

- 859910e: Preserve HTML block structure, blank-line spacing, inline marks, lists, and text alignment when pasting formatted HTML.
- Updated dependencies [eeb5eb2]
  - @input/pen-ingest@0.2.12
  - @input/pen-core@0.2.12
  - @input/pen-markdown@0.2.12
  - @input/pen-types@0.2.12

## 0.2.11

### Patch Changes

- @input/pen-core@0.2.11
  - @input/pen-ingest@0.2.11
  - @input/pen-markdown@0.2.11
  - @input/pen-types@0.2.11

## 0.2.10

### Patch Changes

- @input/pen-core@0.2.10
  - @input/pen-ingest@0.2.10
  - @input/pen-markdown@0.2.10
  - @input/pen-types@0.2.10

## 0.2.9

### Patch Changes

- @input/pen-core@0.2.9
  - @input/pen-ingest@0.2.9
  - @input/pen-markdown@0.2.9
  - @input/pen-types@0.2.9

## 0.2.8

### Patch Changes

- @input/pen-core@0.2.8
  - @input/pen-ingest@0.2.8
  - @input/pen-markdown@0.2.8
  - @input/pen-types@0.2.8

## 0.2.7

### Patch Changes

- @input/pen-core@0.2.7
  - @input/pen-ingest@0.2.7
  - @input/pen-markdown@0.2.7
  - @input/pen-types@0.2.7

## 0.2.6

### Patch Changes

- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
- Updated dependencies [dcd1573]
  - @input/pen-core@0.2.6
  - @input/pen-ingest@0.2.6
  - @input/pen-markdown@0.2.6
  - @input/pen-types@0.2.6

## 0.2.5

### Patch Changes

- @input/pen-core@0.2.5
  - @input/pen-ingest@0.2.5
  - @input/pen-markdown@0.2.5
  - @input/pen-types@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies [4ea7542]
  - @input/pen-types@0.2.4
  - @input/pen-core@0.2.4
  - @input/pen-ingest@0.2.4
  - @input/pen-markdown@0.2.4

## 0.2.3

### Patch Changes

- @input/pen-core@0.2.3
  - @input/pen-ingest@0.2.3
  - @input/pen-markdown@0.2.3
  - @input/pen-types@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [b359f9a]
  - @input/pen-core@0.2.2
  - @input/pen-ingest@0.2.2
  - @input/pen-markdown@0.2.2
  - @input/pen-types@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [ab64f16]
  - @input/pen-core@0.2.1
  - @input/pen-ingest@0.2.1
  - @input/pen-markdown@0.2.1
  - @input/pen-types@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [e9a3129]
- Updated dependencies [e9a3129]
  - @input/pen-core@0.2.0
  - @input/pen-ingest@0.2.0
  - @input/pen-markdown@0.2.0
  - @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- Updated dependencies [7fb7864]
- Updated dependencies [7fb7864]
  - @input/pen-core@0.1.9
  - @input/pen-ingest@0.1.9
  - @input/pen-markdown@0.1.9
  - @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- cb50239: Honor a block schema's `serialize.toHTML` for images (still admitting `src` through SEC1) and keep schema-emitted `<li>` attributes when wrapping list runs.
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
- Updated dependencies [cb50239]
  - @input/pen-core@0.1.8
  - @input/pen-types@0.1.8
  - @input/pen-ingest@0.1.8
  - @input/pen-markdown@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-core@0.1.7
  - @input/pen-ingest@0.1.7
  - @input/pen-markdown@0.1.7
  - @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- d6a3b79: Admit validated `text-align` style keywords and the HTML `align` attribute through HTML sanitization so paste can preserve block alignment.
- Updated dependencies [d6a3b79]
- Updated dependencies [d6a3b79]
  - @input/pen-core@0.1.6
  - @input/pen-types@0.1.6
  - @input/pen-ingest@0.1.6
  - @input/pen-markdown@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
- Updated dependencies [67bf230]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5
  - @input/pen-core@0.1.5
  - @input/pen-ingest@0.1.5
  - @input/pen-markdown@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-core@0.1.4
  - @input/pen-ingest@0.1.4
  - @input/pen-markdown@0.1.4
  - @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-core@0.1.3
  - @input/pen-ingest@0.1.3
  - @input/pen-markdown@0.1.3
  - @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-core@0.1.2
  - @input/pen-types@0.1.2
  - @input/pen-ingest@0.1.2
  - @input/pen-markdown@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [2f9bbe2]
- Updated dependencies [d67b176]
- Updated dependencies [d67b176]
  - @input/pen-core@0.1.1
  - @input/pen-ingest@0.1.1
  - @input/pen-markdown@0.1.1
  - @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. Import and export for Pen with subpaths for HTML, Markdown, JSON, and XML.

### Patch Changes

- e88ceeb: Remove leftover identity helpers, unused public aliases, and duplicated ingest-bound constants after the facet and empty-block migrations.
- Updated dependencies [e88ceeb]
- Updated dependencies [f4e78f9]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
- Updated dependencies [a022804]
  - @input/pen-core@0.1.0
  - @input/pen-types@0.1.0
  - @input/pen-markdown@0.1.0
  - @input/pen-ingest@0.1.0
