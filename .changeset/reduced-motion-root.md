---
"@input/pen-dom": patch
"@input/pen-react": patch
---

AX6: each editor root has one shared reduced-motion signal, `getRootReducedMotion(root)`, and reflects it as a presence-only `data-pen-reduced-motion` attribute on the root. `AX6_MOTION_MAPPING`, `REDUCED_MOTION_ATTR` and `getRootReducedMotion` are exported from `@input/pen-dom`, and `useReducedMotion()` from `@input/pen-react`. The AI suggestion underline no longer transitions under reduced motion.

Breaking: no
