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
3. Let the release workflow open or update the **Version Packages** PR on `main`. In its merge box, select **Approve workflows to run** so the bot PR's required CI checks execute. The bot uses GitHub's built-in `GITHUB_TOKEN`; no GitHub App or personal access token is required.
4. After the checks pass, approve and merge the version PR. Refresh a version PR that is behind `main` to include newer changesets in the same train. If any remain after merging, CI publishes the merged version first and then prepares the next version PR.
5. The **Release / Version or publish** run builds the merged commit, runs the release checks, and calls `pnpm release` (`changeset publish`) to publish every public package. It verifies all expected npm versions, waiting up to two minutes for npm to serve new uploads, before atomically pushing the package tags and the `vX.Y.Z` train tag. It then creates one `vX.Y.Z` GitHub Release whose notes merge the package changelogs; a retry skips a release that already exists, and an older train never takes **Latest**. Runs for other commits skip the build and gates; they only prepare the version PR, whose own checks validate it. Private workspaces stay excluded. Per-package GitHub Releases are disabled.

## Release setup

1. Keep **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** enabled. Existing required reviews and CI checks remain the merge gate.
2. On npm, create a granular access token named `pen-github-release` with **Read and write (publish and stage)**, **Bypass two-factor authentication**, and access to every public package listed in `config.json`'s fixed group (currently 23). The token's owner needs publishing permission for every package; granting organization-management access alone does not grant package publishing. Package settings must allow granular tokens, and the token must permit direct publishing rather than staging only. See [npm token setup](https://docs.npmjs.com/creating-and-viewing-access-tokens/).
3. Store the token as the Actions secret **`NPM_TOKEN`**, either on `input-systems/pen` or on the `input-systems` organization with a repository access policy that includes `pen`. A repository secret with the same name overrides the organization secret. The workflow maps it to `NODE_AUTH_TOKEN` only for the token check and npm publishing step; the runner's npm configuration references that variable instead of storing its value. `id-token: write` signs provenance while the granular token authenticates npm uploads. No additional GitHub secret is needed.
4. The maintainer creating the token owns its rotation: record its expiry, rotate it before expiry (write tokens last at most 90 days), and update `NPM_TOKEN`. Verify the first CI release's package versions, provenance, and train tag. See [npm token policy](https://docs.npmjs.com/about-access-tokens/).

Direct publishing with granular tokens is scheduled to end in **January 2027**. Complete the migration to [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) by **December 2026**: configure each public package for organization `input-systems`, repository `pen`, workflow filename `release.yml`, allowing direct `npm publish`; keep GitHub-hosted runners and `id-token: write`; switch to an OIDC-capable publishing toolchain and remove token-based registry authentication. Update the release precondition checker with that workflow change, verify an OIDC release for every package, then remove `NPM_TOKEN`. This migration also needs no GitHub App. It is separate from the current token-based workflow.

## Recovery

1. Open the failed **Release / Version or publish** run. Fix the reported cause: package permission, token expiry, a missing `NPM_TOKEN`, or a registry, tag-push, or GitHub Release failure. Publishing cannot undo versions already uploaded to npm.
2. Select **Re-run all jobs** on that original run. The checkout stays at the original version commit even if `main` has advanced. Changesets skips package versions already on npm; release completion verifies the whole train and pushes any missing package or train tags even when nothing remains to publish. If npm already has a newer train, missing older versions publish under `release-X.Y.Z` instead of `latest`, preserving the newer release for consumers.
3. Confirm the run summary reports every public package and the `vX.Y.Z` tag, and that the `vX.Y.Z` GitHub Release exists. A tag pointing to another commit fails the run; CI never force-updates a release tag. A later ordinary commit does not publish an incomplete earlier train: recover its original run instead. PR preparation checks the live `main` commit, so older runs cannot overwrite the current version PR. Manual workflow dispatch is limited to `main` and identifies a version commit or prepares the version PR; it does not select arbitrary release revisions.

The first published train was **0.1.0** (tag `v0.1.0`). `pnpm version-packages` still runs `scripts/stamp-first-train.mjs` after `changeset version`; it existed to rewrite a peer-promoted `1.0.0` to `0.1.0` for that first release and is a no-op now that `v0.1.0` exists.

## Notes

- Every published package is in one `fixed` group in `config.json`, so one changeset bumps the whole train. `release-check --version-sync` fails if that group drifts from the published set.
- Private workspace packages (docs, playground, examples, conformance, eslint plugin) are listed in `config.json` `ignore` and excluded from release versioning.
- Public package access is configured repo-wide in `.changeset/config.json` and reinforced in each public package manifest.
- Package metadata can be re-synced with `pnpm sync:package-metadata`.
