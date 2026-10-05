---
"@input/pen-dom": patch
---

Block notifier fixes:

- A released `subscribeListSegments` unsubscribe called again no longer drops a newer subscriber's channel on the same parent, and the last segment subscriber out now releases the notifier's editor subscriptions.
- A multi-block text range with an endpoint in a `children`-array child orders its endpoints by document (preorder) position, so the other endpoint's partial range is no longer reversed.
- A block a concurrent delete removed (COL4) and a later write re-inserted is back in the document snapshot's `rootIds`, including when the re-insert arrived while the notifier was detached.
- A keystroke or caret move in a numbered list item keeps its `list` slice, ordinal included, instead of re-reading the whole numbered run (a 5,000-item run read about 12,500 blocks per keystroke).

Breaking: no
