# Contributing To Pen

Thanks for your interest in improving Pen.

Pen is an MIT-licensed SDK, copyright Input B.V. How packages are
published is stated in the [root README](README.md). Contributions to
the repository are welcome.

## Local Setup

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs the same checks your pull request will meet, in the
same order, and ends with a summary naming the GitHub check behind each
failure. Prefer it over guessing which of the individual commands
applies to your change. Useful flags:

```bash
pnpm verify --list          # print the plan without running it
pnpm verify --bail          # stop at the first failure
pnpm verify --only test     # run the steps whose id contains "test"
```

The individual commands are still there, and are quicker while you
iterate:

```bash
pnpm lint
pnpm build
pnpm typecheck
pnpm test
```

`pnpm lint` is `pnpm lint:format && pnpm lint:eslint`. The format
script runs Prettier on an explicit docs/config path list
(`README.md`, other root markdown, `package.json`, workflow YAML,
`spec/**/*.md`, package READMEs). `packages/**/*.ts` is not on that
list. ESLint owns TypeScript and JavaScript source style.

`pnpm verify` deliberately leaves out the two browser suites, because
neither runs without Playwright binaries this repository will not
install behind your back:

```bash
pnpm exec playwright install --with-deps chromium
pnpm test:e2e                                          # drives playground/
pnpm --filter @input/pen-conformance run test:chromium # browser conformance
```

## What CI Runs

A pull request lands on nine workflows. The pull-request page labels
every check `Workflow / Job`, and each workflow that fans out ends in
one aggregate job depending on all the others. Those aggregates are what
branch protection requires, so a new matrix leg or a new gate blocks
merges the moment it exists, with no repository-settings change.

Branch protection matches the job name on its own, not the
`Workflow / Job` label — which is why no two jobs in this repository
share a name, and why `workflow-integrity` fails if two ever do.

| Required check                       | What it protects                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `CI / All CI jobs`                   | Lint, build, API reports, typecheck, unit and integration tests, playground e2e      |
| `Static analysis / All gates`        | The gate list in `scripts/gates.json`, plus changeset coverage                       |
| `Conformance / All engines`          | Real-browser selection, IME, geometry, and a11y conformance                          |
| `Examples / All examples`            | The React, Vue, and vanilla examples still build and mount against workspace sources |
| `Node / All Node jobs`               | The tree builds and tests on Node 22, Node 26, and macOS                             |
| `Docs / All docs jobs`               | The docs site compiles and its samples typecheck                                     |
| `Supply chain / All audits`          | No advisories reaching a published package, no install scripts, SEC8 lint intact     |
| `Performance / Budgets`              | CH8 performance budgets and the SCALE1 envelope                                      |
| `CodeQL / JavaScript and TypeScript` | Static security analysis                                                             |

Two of these are staged rather than all-or-nothing. Under `CI`, the
Firefox browser leg reports without blocking; under `Conformance`,
WebKit and Firefox do. Each is held on a named defect recorded in the
workflow file — read the comment there before assuming a red leg is
flake.

Adding a static gate means adding an entry to `scripts/gates.json`. The
`Static analysis / Repo gates` job runs that file through the same
`scripts/verify.mjs` you run locally, so CI and `pnpm verify` cannot
drift apart. Every gate runs even after one fails, and the summary at
the end of the job names each failure next to the command that produced
it.

## Repository Shape

- `packages/core` owns editor authority, document state, normalization, and the canonical mutation path.
- `packages/types` owns shared contracts and lightweight helpers.
- `packages/rendering/*` bind the headless runtime to framework-specific surfaces.
- `packages/extensions/*` add optional runtime behavior such as AI, search, import/export, and collaboration.
- `packages/docs` and `playground` are workspace apps used to document and exercise shipped surfaces.
- `examples/` has consumer-style React, Vue, and vanilla apps. They are pnpm workspace members and each has a CI smoke job, so they build against the same workspace sources as everything else.

## Engineering Expectations

- Keep Pen headless and extension-first. Avoid pushing product-specific UI opinions into shared runtime packages.
- Route durable document writes through `editor.apply(ops, options)`.
- Respect package boundaries. Renderer packages should not become alternate sources of document truth.
- Prefer small, focused pull requests over broad refactors.
- Update docs or README examples when you change a public surface or onboarding path.

## Commit Messages

Write an imperative sentence that names the component and the
objective. Do not use conventional-commit prefixes (`feat:`,
`fix:`, `chore:`).

Examples from this repository:

- `Refactor editor extension handling and improve test structure`
- `Enhance inline atom handling and DOM reconciliation`

## License

Outbound license is the [MIT License](LICENSE.md), copyright Input B.V.
By contributing you agree that your work may be distributed under those
terms. The previous license-enforcement clause is retired: MIT has no
such clause, and the repository has no license-enforcement code.

Inbound, the [Contributor License Agreement](CLA.md) grants Input B.V.
copyright and patent licenses over your contribution. The asymmetry with the
outbound MIT license is deliberate:
keeping one copyright holder is what lets Input relicense Pen at all, and the
move off the previous source-available terms to MIT is that mechanism being
used. Submitting a contribution accepts those terms. There is no automated
CLA check or signing workflow in this repository.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Changesets And API Reports

A pull request that changes a published package's behavior or public surface
must include a changeset. From the repository root, run `pnpm changeset`,
select the published packages that changed, pick **minor** or **patch**, and
write a short user-facing summary. Commit the new file under `.changeset/`
with the rest of the work. Private packages such as `@input/pen-docs` are
ignored by versioning and do not need a changeset.

While the train is `0.x`, do not pick `major`. Breaking changes are `minor`;
additive changes are `patch`. `major` would publish `1.0.0` and end the 0.x
policy by accident; `changeset-check` rejects it. Naming any package is
enough to bump the whole train — they share one `fixed` group — but still
name the packages you changed so each CHANGELOG gets a line.

The unpublished placeholder in every manifest is `0.0.1`. The first
`changeset version` lands at **0.1.0**. `scripts/stamp-first-train.mjs`
rewrites a peer-promoted `1.0.0` (workspace peers on the fixed train)
to `0.1.0` and otherwise no-ops when the tree is already there. A
patch-only first bump would land at `0.0.2` and the stamp would fail
rather than publish a surprise number. Later trains are whatever
changesets computes from 0.1.0.

The `changeset` gate enforces this: it names every published package whose
`src/` changed and is not covered. If your branch really ships no behavior
change — a comment, a rename, a test-only refactor — say so with
`pnpm changeset --empty` rather than looking for a way around the gate. Its
population is `src/` only, so a dependency bump inside a published manifest
will not trip it. Call those out in the description by hand.

A pull request that changes a published package's public surface must
update that package's `api-report.md` (`node scripts/api-reports.mjs
--write` after `pnpm build`). CI diffs the committed reports against the
built `.d.ts`.

Know what that gate does and does not catch. `api-report.md` is an
inventory of exported **names**, not of their shapes. Adding, removing or
renaming an export produces a diff and CI stops you. Changing the shape
behind a name does not: adding a required field to an exported interface,
widening a parameter, or changing a return type is a breaking change for
every consumer and produces no diff at all. Call a shape change out in
the PR description. A green `api-reports` run is not review of the
shape.

Release trains share one version across every published package. The
changesets `fixed` group is what produces that; `scripts/release-check.mjs`
(version-sync, publint, are-the-types-wrong) and `scripts/size-limit.mjs`
run before `changeset publish --provenance`. Publishing uses npm trusted
publishing (OIDC from GitHub Actions) rather than a long-lived npm token.
Per-package `CHANGELOG.md` files are generated by `pnpm version-packages`.
Each train also gets a `vX.Y.Z` git tag. None of that has run yet: there
are no tags and no changelogs.

## Pull Request Checklist

- Add or update tests when behavior changes.
- Run the relevant local validation commands before opening a PR.
- Call out user-facing API, package, or docs changes in the PR description.
- Include a changeset when the public surface or published behavior changes.
- Link related issues or context when available.

## Questions And Support

See `SUPPORT.md` for where to ask questions or report bugs.
