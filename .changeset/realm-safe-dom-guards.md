---
"@input/pen-dom": patch
"@input/pen-react": patch
---

Finish the realm-safe node checks for editors mounted in an iframe. Inline atom recognition (chips, hosts, caret boundaries, logical DOM offsets, atom drag targets), the vanilla host's click-to-edit (`handleFieldEditorPointerActivate`), table cell keyboard navigation, the AI keyboard scope, geometry hit testing and measurement, and the React AI suggestions root and selection toolbar no longer use the host window's `Node` / `Element` / `HTMLElement` / `Text` / `Document` constructors. Before, a click on an atom chip or text in an iframe-mounted editor did not activate the field, and arrow keys typed into a native input inside the active table cell moved the cell selection. The AI keyboard scope also resolves the editor root in the event target's document rather than the host window's.

The guards (`isDomNode`, `isDomElement`, `isDomHTMLElement`, `isDomText`, `isDomDocument`, `closestDomElement`) are exported from the new `@input/pen-dom/utils/domNodes` subpath for the framework bindings.

Breaking: no
