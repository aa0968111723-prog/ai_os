# ShotCard.tsx was deleted from this branch by accident

**Impact:** StoryboardStage imports ShotCard → build fails if this branch is deployed.

## Restore (run locally)

```bash
git checkout feat/resource-dock-1802
git checkout origin/claude/healing-migration-ai-os-erewp2 -- client/src/features/storyboard-center/ShotCard.tsx
# Optional: apply dock-drop patch from PR discussion
git add client/src/features/storyboard-center/ShotCard.tsx
git commit -m "fix: restore ShotCard.tsx deleted during Resource Dock push"
git push origin feat/resource-dock-1802
```

Or close PR #621 and re-open from a clean branch after restoring.

Base branch `claude/healing-migration-ai-os-erewp2` still has the full file (verified 200).
