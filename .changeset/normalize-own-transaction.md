---
"@input/pen-core": patch
---

Run every normalization pass outside an apply in one `"system"`-origin transaction the normalizer owns. Closing a text stream normalized its deferred block with untransacted writes, so each repair committed on its own and the normalizer's pass index advanced twice for it — once by the observed delta and once by the repair's own note — and a later `delete-block` could remove a neighbour's order entry. `normalizeAll()` outside an apply now also commits with the `"system"` origin instead of `"user"`, so its repairs no longer join the user's undo stack.

Breaking: no
