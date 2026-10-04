---
"@input/pen-core": patch
---

Capture a queued apply under its own undo key (AIB4). An apply issued from inside another apply (for example from an apply-boundary listener) is queued until the running one finishes, but its capture key was set and restored around the call, so it executed under the outer apply's key: an AI write with a group id merged into the user's typing step. The capture key now travels with each queued apply and wraps its execution.

Breaking: no
