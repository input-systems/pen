# Changesets

Pen uses [Changesets](https://github.com/changesets/changesets) for versioning and npm releases.

## Local workflow

1. Run `pnpm changeset` and describe the user-facing package changes. On `0.x` pick `minor` (breaking) or `patch` (additive). Do not pick `major`.
2. Merge the changeset with the feature work.
3. Let the release workflow open or update the release PR on `main`.
4. When the release PR merges, the release workflow publishes the public packages via npm trusted publishing (OIDC). There is no `NPM_TOKEN`.

The first published train is **0.1.0**. Manifests stay at the unpublished placeholder `0.0.1` until `pnpm version-packages` runs; that command runs `changeset version` and then `scripts/stamp-first-train.mjs`, which rewrites a peer-promoted `1.0.0` to `0.1.0` and no-ops when `changeset version` already landed there. After `v0.1.0` exists the stamp is a no-op. A patch-only first bump would be `0.0.2` and the stamp would fail rather than publish it.

## Notes

- Every published package is in one `fixed` group in `config.json`, so one changeset bumps the whole train. `release-check --version-sync` fails if that group drifts from the published set.
- `@input/pen-docs` is private and excluded from release versioning.
- Private package access is configured repo-wide in `.changeset/config.json` and reinforced in each public package manifest.
- Package metadata can be re-synced with `pnpm sync:package-metadata`.
