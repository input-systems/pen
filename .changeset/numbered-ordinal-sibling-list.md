---
"@input/pen-core": minor
"@input/pen-dom": minor
---

Numbered list values count over the item's AX1 sibling list. `getNumberedListItemValue` and the block notifier's `list.ordinal` now count the numbered items before an item in the sibling list it is grouped and announced in (the root list, a container's `parentId` children, or a `children` array), rather than in the root `blockOrder`. Blocks nested under an earlier sibling no longer continue its count, and items in a `children` array number 1, 2, 3 instead of each showing 1.

Host note: a numbered item that follows a container holding numbered `parentId` children (for example a blockquote) now starts at 1 instead of continuing from the container's last child, matching its `aria-posinset`; markdown export's list `start` follows the same count. The function's signature is unchanged.

Breaking: yes
