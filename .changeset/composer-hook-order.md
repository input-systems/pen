---
"@input/pen-react": patch
---

`Pen.AI.ContextualPromptComposer` mounted before any contextual prompt session no longer throws "Rendered more hooks than during the previous render" when a session opens. It called a state hook and two effects after returning `null` for a missing session; those hooks now live in a body component that renders only with a session.

Breaking: no
