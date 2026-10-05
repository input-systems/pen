# @input/pen-assets

## 0.3.0

### Minor Changes

- 55f100d: Raise `engines.node` from `>=22` to `^22.22.2 || ^24.15.0 || >=26.0.0` (HOST3). `@input/pen-interop` sanitizes HTML through `isomorphic-dompurify` 4.3, which builds its Node window with jsdom 30, and jsdom 30 declares that range; `@input/pen`, `@input/pen-react`, and `@input/pen-vue` depend on interop, so the workspace-wide floor moves with it. Node 22 releases before 22.22.2, Node 24 releases before 24.15.0, and Node 23 and 25 are no longer supported.

  Breaking: yes — hosts running Node below 22.22.2, 24.0–24.14, or 23/25 must move to a supported Node line (^22.22.2, ^24.15.0 or >=26.0.0)

### Patch Changes

- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [4d1c512]
- Updated dependencies [55f100d]
- Updated dependencies [4d1c512]
  - @input/pen-types@0.3.0

## 0.2.14

### Patch Changes

- @input/pen-types@0.2.14

## 0.2.13

### Patch Changes

- @input/pen-types@0.2.13

## 0.2.12

### Patch Changes

- @input/pen-types@0.2.12

## 0.2.11

### Patch Changes

- @input/pen-types@0.2.11

## 0.2.10

### Patch Changes

- @input/pen-types@0.2.10

## 0.2.9

### Patch Changes

- @input/pen-types@0.2.9

## 0.2.8

### Patch Changes

- @input/pen-types@0.2.8

## 0.2.7

### Patch Changes

- @input/pen-types@0.2.7

## 0.2.6

### Patch Changes

- dcd1573: Republish the 0.2.4 train. Those tarballs shipped leftover 0.2.3 `dist/` (no rebuild before `pnpm release`), so `contentRole`, `getBlockContentRole`, and `getDocumentPlaceholderTargetBlockId` were in source and the changelog but not in the packages.
- Updated dependencies [dcd1573]
  - @input/pen-types@0.2.6

## 0.2.5

### Patch Changes

- @input/pen-types@0.2.5

## 0.2.4

### Patch Changes

- Updated dependencies [4ea7542]
  - @input/pen-types@0.2.4

## 0.2.3

### Patch Changes

- @input/pen-types@0.2.3

## 0.2.2

### Patch Changes

- @input/pen-types@0.2.2

## 0.2.1

### Patch Changes

- @input/pen-types@0.2.1

## 0.2.0

### Patch Changes

- @input/pen-types@0.2.0

## 0.1.9

### Patch Changes

- @input/pen-types@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [cb50239]
  - @input/pen-types@0.1.8

## 0.1.7

### Patch Changes

- @input/pen-types@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [d6a3b79]
  - @input/pen-types@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [c926c5e]
- Updated dependencies [c926c5e]
  - @input/pen-types@0.1.5

## 0.1.4

### Patch Changes

- @input/pen-types@0.1.4

## 0.1.3

### Patch Changes

- @input/pen-types@0.1.3

## 0.1.2

### Patch Changes

- 3f82c15: Updated playground hosting & docs
- Updated dependencies [e80fedc]
- Updated dependencies [3f82c15]
  - @input/pen-types@0.1.2

## 0.1.1

### Patch Changes

- @input/pen-types@0.1.1

## 0.1.0

### Minor Changes

- a022804: First public release. An in-memory asset provider for Pen, intended for tests and local development.

### Patch Changes

- Updated dependencies [e88ceeb]
- Updated dependencies [a022804]
  - @input/pen-types@0.1.0
