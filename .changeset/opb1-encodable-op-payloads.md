---
"@input/pen-core": patch
---

`editor.apply` drops an op whose payload the CRDT cannot encode with `diagnostic { code: "PEN_APPLY_004" }` instead of writing it (OPB1). A `set-meta` without a non-empty string `namespace` used to write an `undefined` map key, after which `Y.encodeStateAsUpdate` threw and the document could no longer sync or persist; cyclic prop, meta, and app values, non-JSON mark values and atom props, missing `props`, and malformed positions are rejected the same way. Shape validation now runs before any other validate check, so a malformed op no longer throws from `apply`.

Breaking: no
