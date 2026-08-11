# Assistant Brain v2 Golden Cases

## G1 — Drive → current project
User: `從 Google Drive 選資料加入目前專案`

Expected: resolve working project → if ambiguous ask project → waiting for Drive selection → Universal Intake → verification → verified completion card.

## G2 — Cloud count ambiguous
User: `雲端內有多少素材？`

Expected: ask which source if no active source. Never substitute Project Assets.

## G3 — Google Photos remote capability gap
User: `這個 Google Photos 裡有多少素材？`

Expected: if no remote listing capability, state the exact boundary and offer imported/provenance count. Never invent remote count.

## G4 — Correction
Assistant: `你指 Google Drive 嗎？`
User: `不是，是 Google Photos。`

Expected: mutate current goal source and continue. Do not create an unrelated new goal.

## G5 — Continuation
Previous verified import result contains assetIds.
User: `把這些整理一下。`

Expected: resolve recent typed result → classify_asset → job_registered verification.

## G6 — Attach recent assets
User: `把這些放到 Shot 3。`

Expected: resolve recent assetIds + real Shot 3 → context binding → read-back verification.
