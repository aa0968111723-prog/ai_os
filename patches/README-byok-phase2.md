# BYOK Phase 2 patches

Apply on top of the Phase 2 foundation (PR #365 / commit with fal apiKey + usedUserKey meta).

## Apply

```bash
# From repo root, on a branch that already has Phase 1 + Phase 2 foundation:
patch -p0 < patches/byok-phase2-generationCore.patch
patch -p0 < patches/byok-phase2-decideCost.patch
# or:
git apply patches/byok-phase2-generationCore.patch
git apply patches/byok-phase2-decideCost.patch
```

## What each patch does

### generationCore.patch
- Resolve `getDecryptedKey(userId, "fal")` for non-NIM models
- Skip member cost-approval threshold when `usedUserKey`
- Skip `reserveQuota` when `usedUserKey`
- Pass `{ apiKey }` to `falSubmit`
- Persist `usedUserKey` in generation source meta
- `advanceGeneration`: re-resolve key for `falStatus`; missing key fails without refund
- `pointsActual = 0` when personal key was used

### decideCost.patch
- Same dual-billing on cost-approval path
- Preserve `usedUserKey` + ablation when rewriting params after URL re-sign
- Refund / `pointsRefunded` only when platform points were reserved

## Verify

```bash
npm run typecheck
# Manual: set personal fal key + preferUserKey → generate → 0 points
# Manual: no personal key → normal points path
```
