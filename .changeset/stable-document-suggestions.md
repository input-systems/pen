---
"@input/pen-ai": patch
---

Document-scope suggestions no longer churn on every re-analysis: a repeated fix keeps its id and anchor, a late response is anchored against the live document instead of the text it was asked about, and a dismissed fix stays dismissed across edits elsewhere in the body.
