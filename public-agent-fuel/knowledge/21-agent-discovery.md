# How Agents Discover Public Fuel

1. Query global data table named 公共Agent素材庫
2. Filter by category: knowledge | style | scene | character | negative | emotion
3. Use `key` for idempotent reference
4. Prefer entries tagged public + agent-fuel

Do not treat project-scoped knowledge as the only source of truth for general creative rules.
