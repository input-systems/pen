---
"@input/pen-dom": patch
---

A root that outlives its editor no longer keeps the editor alive. Detaching a root (field editor `destroy()` or `setRootElement(null)`) now releases the root's geometry reader — its ResizeObserver and document scroll-capture listener — and moves the overlay off the root, so the root holds no path to the editor or its field editor. Re-attaching the same root for the same editor (React Strict Mode) still gets the same overlay back, contributors and holds intact, with a fresh reader and scheduler.

Breaking: no
