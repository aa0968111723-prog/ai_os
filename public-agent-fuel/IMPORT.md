# Terminal Import

```bash
npx tsx scripts/import-public-agent-fuel.ts --dry-run

PUBLIC_FUEL_CREATED_BY=<developer-uuid> \
  npx tsx scripts/import-public-agent-fuel.ts --apply
```

Writes only to `data_tables.scope = global`.
Refuses `--projectId`.
After import, agents can read **公共Agent素材庫**.
