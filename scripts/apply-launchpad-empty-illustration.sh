#!/usr/bin/env bash
# Apply the last #433 wire: Launchpad empty projects illustration
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
if grep -q 'EmptyIllustration name="emptyProjects"' client/src/pages/Launchpad.tsx 2>/dev/null; then
  echo "already wired"
  exit 0
fi
if command -v patch >/dev/null; then
  patch -p1 < patches/launchpad-empty-illustration.patch
else
  # pure sed fallback
  python3 - <<'PY'
from pathlib import Path
p = Path("client/src/pages/Launchpad.tsx")
t = p.read_text(encoding="utf-8")
after = 'import { Icon } from "../components/Icon";\n'
line = 'import { EmptyIllustration } from "../components/EmptyIllustration";\n'
if "EmptyIllustration" not in t:
    if after not in t:
        raise SystemExit("no import anchor")
    t = t.replace(after, after + line, 1)
old = '<EmptyState icon={<Icon name="Package" />}'
new = '<EmptyState icon={<EmptyIllustration name="emptyProjects" />}'
if old not in t:
    raise SystemExit("no empty state pattern")
t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8")
print("wired via python")
PY
fi
echo "done — git add client/src/pages/Launchpad.tsx && git commit -m 'feat(ui): wire Launchpad empty projects illustration' && git push"
