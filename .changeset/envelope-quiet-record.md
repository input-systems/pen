---
"@input/pen-bench": patch
---

Re-record the SCALE1 envelope on a quiet machine (load 4.45 on 14 CPUs, 2026-10-02) and make the generated table's clock wording follow the record's load state instead of hard-coded dates. The previous record was taken under load before the commit path stopped re-reading the whole document; a 5,000-block keystroke now records 0.23ms (was 6.13ms) and the two-peer sync 0.06ms (was 1.49ms), so every rung is below the 0.5ms clock signal and only counts gate.

Breaking: no
