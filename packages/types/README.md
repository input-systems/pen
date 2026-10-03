# `@input/pen-types`

`@input/pen-types` is not a package to install alone. Install `@input/pen-core` or `@input/pen`; those depend on this package and re-export the contracts a host actually uses.

This package is the shared type, constant, and guard surface for Pen. It does not create an editor, apply ops, or render a surface.

The only runtime helper most hosts touch is `generateId()`, which is the HOST4 ID source (a v4 UUID). Everything else is types, frozen constants, and type guards.

## Install

This package has no peer dependencies. Hosts should install `@input/pen-core` instead of depending on this package directly.

```bash
pnpm add @input/pen-types
```

`engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`.

## Usage

```ts
import { generateId } from "@input/pen-types";
import type { DocumentOp } from "@input/pen-types";

const id = generateId();
const ops: DocumentOp[] = [];
void id;
void ops;
```

Prefer importing `createEditor` from `@input/pen-core` in application code. Import `DocumentOp` from this package — `@input/pen-core` does not re-export it. Reach for this package when you are writing an extension or a typed helper that must not depend on the runtime.

## Options

This package has no options.

## Documentation

The docs site (the `@input/pen-docs` package) covers this area on the Core concepts page (`#/core-concepts`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input B.V. See [`LICENSE.md`](./LICENSE.md).
