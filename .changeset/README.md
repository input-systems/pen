# Changesets

Pen uses [Changesets](https://github.com/changesets/changesets) for versioning and npm releases.

## Local workflow

1. Run `pnpm changeset` and describe the user-facing package changes. On `0.x` pick `minor` (breaking) or `patch` (additive). Do not pick `major`.
   Then end the body with one line: `Breaking: yes — <what a host must change>` or `Breaking: no`. `changeset-check` fails on a missing line, on `Breaking: yes` with `patch`, and on `Breaking: no` with `minor` while the train is `0.x`. If a change breaks one package and only adds to another, write two changesets. Keep it last so the summary, not the grading, heads the CHANGELOG entry. Empty changesets (`pnpm changeset --empty`) need no line.

   ```md
   ---
   "@input/pen-core": minor
   ---

   Summary for the CHANGELOG. Its first line becomes the CHANGELOG bullet.

   Breaking: yes — hosts pass `origin` to `selectText` to keep pointer attribution
   ```

2. Merge the changeset with the feature work.
3. Let the release workflow open or update the release PR on `main`.
4. When the release PR merges, publish from a maintainer terminal: `git pull`, then `pnpm release` (`changeset publish`). Tag the train with `vX.Y.Z` and push that tag. GitHub does not publish.

The first published train is **0.1.0**. Manifests stay at the unpublished placeholder `0.0.1` until `pnpm version-packages` runs; that command runs `changeset version` and then `scripts/stamp-first-train.mjs`, which rewrites a peer-promoted `1.0.0` to `0.1.0` and no-ops when `changeset version` already landed there. After `v0.1.0` exists the stamp is a no-op. A patch-only first bump would be `0.0.2` and the stamp would fail rather than publish it.

## Notes

- Every published package is in one `fixed` group in `config.json`, so one changeset bumps the whole train. `release-check --version-sync` fails if that group drifts from the published set.
- Private workspace packages (docs, playground, examples, conformance, eslint plugin) are listed in `config.json` `ignore` and excluded from release versioning.
- Private package access is configured repo-wide in `.changeset/config.json` and reinforced in each public package manifest.
- Package metadata can be re-synced with `pnpm sync:package-metadata`.
