# InstantID Weight Tuning Techniques

## Main Parameters

| Parameter | Controls | Typical range |
|-----------|----------|---------------|
| weight (basic) | Overall InstantID strength | 0.6 – 1.0 |
| ip_weight (Advanced) | Identity embedding (who) | 0.6 – 0.9 |
| cn_strength (Advanced) | Keypoints / pose / expression geometry | 0.4 – 0.8 |
| start_at | When InstantID starts | 0.0 |
| end_at | When InstantID stops | 0.8 – 1.0 |
| noise injection | Reduces burned look | 0.2 – 0.4 |

## Tuning by Goal

### Maximum identity lock
- ip_weight 0.85–1.0
- cn_strength 0.5–0.65
- noise 0.35
- CFG 4–5

### Expression change while keeping identity
- ip_weight 0.75–0.85
- cn_strength 0.45–0.6 (lower so expression can move)
- Use different image on image_kps

### More style freedom
- ip_weight 0.65–0.75
- cn_strength 0.4–0.55
- end_at 0.75–0.85

## Diagnostic Table

| Problem | Fix |
|---------|-----|
| Burned / over-sharpened | Lower weight, add noise 0.3–0.4 |
| Identity drifts | Raise ip_weight |
| Expression stiff | Lower cn_strength |
| Expression does not change | Different expression ref on image_kps |
| Face collapses | CFG → 4–5, lower cn_strength |
| Style washed out | end_at 0.75–0.85 |

## Safe Default
```
weight / ip_weight = 0.8
cn_strength        = 0.55
start_at           = 0.0
end_at             = 1.0
noise              = 0.35
CFG                = 4.5
```

Author note: InstantID model ~25% of composition; ControlNet drives the rest. Tune cn_strength for pose/expression, ip_weight for face identity.
