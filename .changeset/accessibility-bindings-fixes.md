---
"@input/pen-dom": patch
"@input/pen-react": patch
"@input/pen-vue": patch
---

Accessibility, iframe and binding fixes:

- **Reduced motion (AX6):** each root has one shared reduced-motion signal. The new `getRootReducedMotion`, `AX6_MOTION_MAPPING` and `REDUCED_MOTION_ATTR` are in pen-dom, and `useReducedMotion()` is in pen-react. The AI suggestion underline no longer animates under reduced motion.
- **Announcements (AX2):** live-region announcements are written in the scheduler's write phase.
- **Focus return for custom chrome (AX3):**
  - New `captureFocusReturn` / `restoreFocusReturn` implement the focus-return rule.
  - The slash, suggestion and table column menus dismiss on an outside `pointerdown`.
- **Iframe-mounted editors:**
  - Every node and event check uses realm-safe guards, exported from the new `@input/pen-dom/utils/domNodes` subpath (`isDomNode`, `isDomElement`, `isDomEvent` and others).
  - Nodes are created in the field's own document, and chrome resolves its document through `resolveEditorOwnerDocument`.
- **`asChild`:** `asChild` composes the child's handlers, class names and styles with the primitive's instead of replacing them.

Breaking: no
