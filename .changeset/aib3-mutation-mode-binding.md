---
"@input/pen-ai": patch
---

Keep a generation's staged-write binding when an overlapping generation ends (AIB3). The tool mutation mode was one save-and-restore slot per editor, so a generation cancelled after the next one had bound restored its own earlier value over the later binding, and the running generation's suggest-mode writes landed unstaged. Each generation's binding is now its own entry that only its unbind removes, and the most recent live binding decides.

Breaking: no
