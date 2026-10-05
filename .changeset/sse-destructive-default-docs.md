---
"@input/pen-transport": patch
---

Document that `createSSEHandler` and `directTransport` run destructive tool calls by default when no `confirm` resolver is configured (`unconfirmedDestructive` defaults to `"allow"`), so a server reachable by clients should pass `"refuse"` or a `confirm`, and that per-turn budgets and the undo group start fresh with each request. Behaviour is unchanged.

Breaking: no
