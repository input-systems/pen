---
"@input/pen-dom": patch
---

Touch selection handles keep their range: a coarse-pointer long-press (`selectstart` or `contextmenu`) that establishes a non-collapsed range in a field opens the reader's state-based `native-range` gesture window, so a handle drag's `selectionchange` is accepted with origin `pointer` instead of being projected back. The window closes on the next in-content `pointerdown`, the read that collapses the range, or a non-reader authority write. `GestureWindowState` gains `nativeRange` and `nativeRangePending`, and `GestureEventKind` gains `touch-selectstart`, `native-range-established`, `native-range-collapsed` and `authority-superseded`.

Breaking: no
