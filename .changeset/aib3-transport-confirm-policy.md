---
"@input/pen-ai": patch
"@input/pen-transport": patch
---

Apply the AIB3 destructive-call policy on the external tool surfaces. `directTransport`, `createSSEHandler`, and `processStream` built their tool turns with only the mutating-tool allowlist, so `aiExtension({ unconfirmedDestructive: "refuse" })` — the production setting for exactly these surfaces — never reached them and an unconfirmed `delete_block` ran. `aiExtension` now publishes its `confirm` / `unconfirmedDestructive` on `aiToolConfirmPolicyFacet`, the three surfaces resolve their turn's policy from the editor through `resolveAIToolConfirmPolicy`, and each takes explicit `confirm` / `unconfirmedDestructive` options that win over the editor's.

Breaking: no
