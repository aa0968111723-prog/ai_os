# InstantID + LoRA Integration Methods

## Correct Node Order
```
CheckpointLoaderSimple
  → LoraLoader (Character / Style)   # LoRA first
  → ApplyInstantID                   # InstantID second
  → KSampler
```

## Patterns

| Pattern | Use case | Weights |
|---------|----------|--------|
| Character LoRA + InstantID | Face + body/outfit | LoRA 0.65–0.85 · InstantID 0.75–0.9 |
| Style LoRA + InstantID | Face locked, style changes | Style 0.5–0.7 · InstantID 0.7–0.85 |
| Character + Style + InstantID | Full control | Char 0.7–0.85 · Style 0.4–0.6 · InstantID 0.75–0.85 |

## Ownership Split

| Element | Owner |
|---------|-------|
| Face identity | InstantID |
| Body / proportions | Character LoRA |
| Outfit | Character LoRA or prompt |
| Art style | Style LoRA + prompt |
| Expression / head pose | InstantID image_kps + prompt |

## Do Not
- Run both InstantID and LoRA at 1.0
- Put InstantID before LoRA in the graph
- Forget LoRA trigger words in the prompt

## Recipes

Strong face + body:
```
Character LoRA = 0.75
InstantID      = 0.82
cn_strength    = 0.55
CFG            = 4.5
```

Style priority:
```
Style LoRA   = 0.65
InstantID    = 0.72
end_at       = 0.85
```
