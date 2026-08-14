# PR #742 chip in-place workspace evidence

Live Playwright run against a local `E2E_MOCK=1` server (seed admin).
Script: `scripts/e2e-ui/pr742-chip-workspace.mjs`.

## Viewports

| Viewport | Overflow X | Chip min-height | Slot below chips | Second rail | Result |
| --- | --- | --- | --- | --- | --- |
| 390×844 | 0 | 44 | yes | none | PASS |
| 430×932 | 0 | 44 | yes | none | PASS |
| 768×1024 | 0 | 44 | yes | none | PASS |
| 1280×800 | 0 | 44 | yes | none | PASS |
| 1440×900 | 0 | 44 | yes | none | PASS |

## Observed flow

1. Login → create project → save + mock parse (角色 2 / 場景 1 / 道具 1 / 造型 1).
2. Click 角色 → CharacterCards appear in `#story-reveal-slot` under the chips.
3. Click 場景 → same slot replaces with ScenePresetCards.
4. Click 場景 again → slot collapses.
5. Mock `generateStoryboard` → 分鏡 chip shows 2 場 4 鏡; slot opens Storyboard.
6. 「生成影片」 CTA clicked (mock batch; no paid provider).

Chips expose `aria-expanded` and `aria-controls="story-reveal-slot"`.
No `.story-inline-rail` second nav.

## Limits

- PostHog dummy env required for Vite (`VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`); missing keys crash SessionGate in DEV.
- Generation used `E2E_MOCK=1`. No paid Fal/NIM calls.
- Deep Shot editor / export zip were not driven in this pass; those stay on the existing SceneStudio / DeliveryRoom paths.
