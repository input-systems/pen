---
"@input/pen-test": patch
---

Adds `createPeerHarness(n)` (2–16 peers forked from one seed) with explicit `deliver` over the adapter or a provider-style `Y.applyUpdate`, named and seeded delivery schedules (`PEER_SCHEDULES`, `runPeerSchedules`), `quiesce()` that exchanges normalization repairs until no peer's state moves (`PeerHarnessQuiesceError` after `MAX_QUIESCE_ROUNDS`), and an awareness relay. Adds the COL4 structural oracle `findStructuralViolations()` / `assertStructuralInvariants()` (cycles, duplicate, dangling, orphan, and cross-array entries). `createTwoPeerHarness()` is now the two-peer form of `createPeerHarness` with unchanged types, messages, and delivery order; `destroy()` now also destroys each peer's `Y.Doc`.

Breaking: no
