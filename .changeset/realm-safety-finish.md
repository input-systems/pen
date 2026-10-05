---
"@input/pen-dom": patch
"@input/pen-react": patch
"@input/pen-vue": patch
---

Finish realm safety for editors mounted into an iframe. The React content gestures resolved no block for a press, click or shift-click on iframe nodes (`instanceof HTMLElement`/`Node` against the host window), the line-edge measure for Home/End and menu placement queried the host document, an EditContext `compositionend` from the iframe's realm dropped its committed text, and field DOM, marks and atoms were created in the global document. Every node and event check in pen-dom, pen-react and pen-vue now uses the realm-safe guards in `@input/pen-dom/utils/domNodes` (new: `isDomEvent`, `isDomCompositionEvent`), nodes are created in the field's own document, and chrome that only has the editor resolves its root's document through the new `resolveEditorOwnerDocument` (`@input/pen-dom/utils/aiDomScope`). React chrome listeners (AI, slash and suggestion menus, the table column menu, the selection toolbar) bind to that document.

Breaking: no
