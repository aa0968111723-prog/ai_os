# Visual Creative starter assets

The runtime manifest resolves every semantic preset to:

`/creative-choice/starter-v1/<family>/<stable-preset-id>.webp`

Add or replace a bitmap at that path to ship production art without changing
React, prompt semantics, or preset ids. Until a bitmap exists, the client falls
back to the preset's accessible SVG diagram or color swatch. These files are
static product assets and never trigger an AI generation request.

Recommended export: WebP, 3:2, 720×480 (a smaller thumbnail can be declared by
the TypeScript manifest when the pack needs one). Preserve meaningful alt text
in the semantic manifest rather than encoding copy into the bitmap.
