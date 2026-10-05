---
"@input/pen-dom": patch
---

Block notifier fixes:

- A released `subscribeListSegments` unsubscribe called again no longer drops a newer subscriber's channel on the same parent, and the last segment subscriber out now releases the notifier's editor subscriptions.

Breaking: no
