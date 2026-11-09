---
"@input/pen-dom": patch
---

Remote caret name labels read their gap above the caret from the new `--pen-peer-label-gap` custom property (default `8px`, unchanged). `overlayLabelStyle()` now keeps the caret's position in `translate3d(...)` and lifts the label with `translateY(calc(-100% - var(--pen-peer-label-gap, 8px)))`; a binding that parses the old `translate3d(x, y - 8px, 0) translateY(-100%)` shape must read the new one.

Breaking: no
