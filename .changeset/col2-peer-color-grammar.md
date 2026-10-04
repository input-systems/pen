---
"@input/pen-multiplayer": minor
---

`normalizeMultiplayerColor` admits a peer colour only through a closed grammar (COL2): a hex colour, a CSS named colour, or `rgb`/`rgba`/`hsl`/`hsla` whose arguments are plain numbers, `%`, `deg`, `,`, `/`, and spaces. Before, `rgb(0,0,0) url(https://evil/x.png)` passed and every viewer fetched the URL through the caret's `background`. Exotic colours that used to pass — `var(--brand)`, `color-mix(…)`, `oklch(…)`, CSS-wide keywords such as `inherit` — now fall back to the assigned palette colour, locally and for remote peers.

Breaking: yes — a host that set `user.color` to `var(--…)`, `inherit`, or a non-`rgb`/`hsl` colour function must pass a hex, named, `rgb`, or `hsl` colour instead
