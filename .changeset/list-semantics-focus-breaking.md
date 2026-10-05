---
"@input/pen-core": minor
"@input/pen-dom": minor
"@input/pen-react": minor
"@input/pen-vue": minor
---

List items are announced as lists (AX1), numbering follows the announced list, and focus returns to its invoker by primitive class (AX3).

- Each run of list items renders inside a `div[data-pen-list-group][role="list"]`. Each item's host carries `role="listitem"`, `aria-level`, `aria-posinset` and `aria-setsize`. This applies on React, Vue and `mountEditor`.
- New core helpers `getListSegments`, `getListItemSemantics` and `isListItemType` describe these lists.
- `getNumberedListItemValue` and the notifier's `list.ordinal` count numbered items over the item's sibling list instead of the root `blockOrder`. Markdown export's list `start` follows the same count.
- Toolbar buttons and toggles keep focus in the field: they prevent the primary-button `mousedown` default. Escape returns focus to the editor.
- The selection toolbar, block handle menu, table column menu, AI command menu and AI contextual prompt return focus to their invoker synchronously.

Host migration:

- Hosts that walk the blocks host's direct children, or style list items with `[data-pen-editor-block] + [data-pen-editor-block]`, must also look inside the `[data-pen-list-group]` wrappers. Items moving between groups are remounted by React and Vue.
- A numbered item that follows a container with numbered `parentId` children now starts at 1, and items in a `children` array number 1, 2, 3. Hosts or snapshots that expect the old numbering update it. There is no API change.
- Hosts whose toolbar `onClick` handlers relied on the button holding focus (for example by reading `document.activeElement`) read the editor selection instead.
- Hosts that refocused the editor themselves after the AI command menu or contextual prompt closed remove that refocus.

Breaking: yes — hosts look inside `[data-pen-list-group]` wrappers when walking or styling list items, update expected numbered-list values after containers, read the editor selection instead of toolbar focus, and drop their own refocus after AI menus close
