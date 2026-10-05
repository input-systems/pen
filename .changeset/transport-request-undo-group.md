---
"@input/pen-transport": patch
---

`directTransport` and `createSSEHandler` give each request's tool turn its own undo group (AIB4). Their tool writes carried a bare `ai` origin, so a request whose tool calls applied several times, or awaited between writes, became several undo steps, and the user's typing between two writes split it further. Every write of one request now carries the request's `groupId` and `undoGroupId` and undoes as one step.

Breaking: no
