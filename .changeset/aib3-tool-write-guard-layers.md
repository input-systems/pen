---
"@input/pen-ai": patch
---

Make the tool-call write guard per call (AIB3). Each open call swapped `editor.apply` (and `openTextStream`, and a read-only call's streaming-target and writer methods) in and restored the value it saw on close, so two calls that overlapped and closed out of order either dropped the later call's guard or left the earlier, already closed call's guard on the editor for good, refusing every later write when it was read-only. Each call now holds its own layer, the most recent live call's guard decides, closing removes only that layer, and the original methods come back when the last call closes.

Breaking: no
