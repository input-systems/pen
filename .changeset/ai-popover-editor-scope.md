---
"@input/pen-react": patch
---

Scope the AI suggestions popover to its own editor. With two editors on a page, the popover set `aria-controls`/`aria-activedescendant` on the first editor's field and Escape focused the first editor's root, whichever editor the popover belonged to. Both now resolve the root through the editor's view id.

Breaking: no
