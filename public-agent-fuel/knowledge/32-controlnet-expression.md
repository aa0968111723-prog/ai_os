# ControlNet for Expression Control

ControlNet controls **structure**, not emotion words. Pair it with an identity method.

## Stack

| Goal | Tool |
|------|------|
| Same face | InstantID / IP-Adapter FaceID / PuLID |
| Expression / head pose | ControlNet OpenPose Face or InstantID keypoints |
| Body pose | ControlNet OpenPose |

## Workflow
1. Identity reference (front portrait)
2. Expression reference (target mouth/eyes/brows)
3. InstantID on identity image
4. image_kps or OpenPose Face on expression image (strength 0.4–0.7)
5. Prompt with visible expression language
6. CFG 4–5

## Limitations
- OpenPose Face alone does not preserve identity
- Extreme expressions need lower CN strength + strong text description
- Always dual-lock: identity path + expression path
