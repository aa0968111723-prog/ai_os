# Sequential Shot Consistency

## Rules
1. Copy the exact same Identity block to every shot (never rewrite).
2. Only change Action + Camera + Framing.
3. Keep outfit, colors, accessories identical.
4. Prefer "same character as previous shot" + full identity text.

## Agent rule
When generating shot N+1, load identity from character card or previous prompt. Do not paraphrase.
