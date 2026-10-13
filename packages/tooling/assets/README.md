# `@input/pen-assets`

In-memory `AssetProvider` test double for Pen. Not a production store.

## Install

```bash
pnpm add @input/pen-assets
```

## What It Provides

- `memoryAssets()` to create an in-memory `AssetProvider`
- upload, resolve, and delete behavior backed by a local object store
- object-URL based asset refs for local development and tests
- `maxSize` and `onProgress` implemented on `upload` (see below)

## Usage

```ts
import { memoryAssets } from "@input/pen-assets";

const assets = memoryAssets({ maxSize: 2_000_000 });

const ref = await assets.upload(new Blob(["hello"], { type: "text/plain" }), {
  mimeType: "text/plain",
  onProgress: (progress) => {
    console.log(progress);
  },
});

const url = assets.resolve(ref);
await assets.delete(ref);
```

## maxSize and onProgress

Both `AssetUploadOptions` members are **implemented** on this provider (not
host-only stubs):

- **`maxSize`** — `memoryAssets({ maxSize })` sets `provider.maxSize`.
  `upload` uses `options.maxSize ?? provider.maxSize`. An oversize file
  throws `File size <actual> exceeds maxSize <limit>` and is not stored.
- **`onProgress`** — invoked at `0` immediately before the store write and
  `1` immediately after. There are no intermediate values; the upload is
  in-memory.

Direct `upload` calls (tests, playground) therefore reject oversize files
the same way Pen's paste path does after it forwards these options.

## delete

`AssetProvider.delete` is **host-implemented**. Pen never calls it.

This provider implements `delete` so hosts and tests can remove a stored
ref. It does not garbage-collect unused assets across documents: Pen cannot
know whether a removed block's asset is still referenced by another document,
a version snapshot, or a collaborator's pending undo. Hosts own reference
counting and should call `delete` only when their count reaches zero.

## Integration Notes

- This provider is a test double for tests, demos, and local playground flows.
- It is not a durable production storage layer.
- Uploaded refs are kept in memory for the lifetime of the provider instance
  until the host calls `delete`.

## Options

| Option                | Default | Effect                                                                         |
| --------------------- | ------- | ------------------------------------------------------------------------------ |
| `maxSize`             | unset   | Provider-level upload cap. `upload` uses `options.maxSize ?? provider.maxSize` |
| `rejectUpload`        | unset   | Failure double: throw after the size check, before `onProgress` or store       |
| `rejectAfterProgress` | unset   | Mid-transfer double: `onProgress(0)`, then throw without storing               |
| `uploadUrl`           | unset   | Store this URL instead of a blob URL. This double does not admit URLs          |

`onProgress` is an `upload` option, not a factory option. This provider calls it at `0` then `1`. `resolve` returns the stored URL or echoes `ref.url` for unknown refs — it is not a sanitizer.

## Documentation

The docs site (the `@input/pen-docs` package) covers runtime floor notes on the Browser and Node page (`#/support`).

The public signatures of record are in `api-report.md` next to this package's source in the Pen repository. The docs site does not host a generated browsable reference.

## License

MIT © Input Systems B.V. See [`LICENSE.md`](./LICENSE.md).
