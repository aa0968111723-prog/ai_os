# ComfyUI Node Order for Expression Control

## Minimal InstantID Path
```
1. CheckpointLoaderSimple
2. LoadImage (Identity)
3. LoadImage (Expression Ref)
4. InstantIDModelLoader
5. InstantIDFaceAnalysis
6. ControlNetLoader (InstantID CN)
7. ApplyInstantID
     image = Identity
     image_kps = Expression Ref
     weight ≈ 0.75–0.85
8. CLIPTextEncode (+)
9. CLIPTextEncode (-)
10. EmptyLatentImage
11. KSampler (CFG 4–5)
12. VAEDecode → Save
```

## Optional Extra OpenPose Face
Expression image → OpenPose Face Preprocessor → ControlNetApplyAdvanced (0.4–0.6) → merge conditioning

## Key Idea
- image = who
- image_kps = what expression / head pose
