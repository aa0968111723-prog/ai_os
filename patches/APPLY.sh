#!/usr/bin/env bash
# Apply BYOK Phase 2 wiring patches onto generationCore + decideCost.
# Run from repo root on a branch that already has Phase 1 + PR #365 foundation.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Applying generationCore dual-billing..."
patch -p0 < patches/byok-phase2-generationCore.patch
echo "Applying decideCost dual-billing..."
patch -p0 < patches/byok-phase2-decideCost.patch
echo "Done. Run: npm run typecheck"
