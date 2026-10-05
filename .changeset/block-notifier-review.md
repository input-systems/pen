---
"@input/pen-dom": patch
---

Block notifier fixes:

- A released `subscribeListSegments` unsubscribe called again no longer drops a newer subscriber's channel on the same parent, and the last segment subscriber out now releases the notifier's editor subscriptions.
- A multi-block text range with an endpoint in a `children`-array child orders its endpoints by document (preorder) position, so the other endpoint's partial range is no longer reversed.

Breaking: no
