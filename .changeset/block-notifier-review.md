---
"@input/pen-dom": patch
---

Block notifier fixes:

- A released `subscribeListSegments` unsubscribe called again no longer drops a newer subscriber's channel on the same parent, and the last segment subscriber out now releases the notifier's editor subscriptions.
- A multi-block text range with an endpoint in a `children`-array child orders its endpoints by document (preorder) position, so the other endpoint's partial range is no longer reversed.
- A block a concurrent delete removed (COL4) and a later write re-inserted is back in the document snapshot's `rootIds`, including when the re-insert arrived while the notifier was detached.
- A keystroke or caret move in a numbered list item keeps its `list` slice, ordinal included, instead of re-reading the whole numbered run (a 5,000-item run read about 12,500 blocks per keystroke).
- A container subscribed only through `subscribeListSegments` re-segments when a `parentId`-route child is removed, re-parented or merged away, and a merge re-segments the array its source left (`sourceParentId`).
- `getListSegments` read before `subscribeListSegments` (React reads in render and subscribes in an effect) is current once subscribed: a read attaches the notifier, a commit that touches an unsubscribed cached list drops it, and the notifier detaches at an event with no subscriber left. A subscribed list is no longer patched from a list cached before it subscribed.
- `getBlockSnapshot` read before `subscribeBlock` is kept current the same way and keeps its identity across events that do not name the block (a newly mounted React block is no longer re-rendered with new slice identities and a reset `domSyncVersion` by an unrelated event); a commit that names it drops it. A snapshot read while no subscriber existed is no longer returned stale after a commit.
- `getDocumentSnapshot` attaches like the other reads, and COL4 dead root entries the notifier tracked stay skipped across a detach.
- The notifier finds the containers a commit changed by core's `childrenOf` identity, so a sibling mounted alone (virtualized) hears a `parentId`-route child leave its container, and only commits re-read a block's place in the tree, so an undo's `decorationsChange` emitted before its commit no longer hides the change from the commit. A write that only restores a dead block's map entry (COL4) now re-reads `rootIds`.

Breaking: no
