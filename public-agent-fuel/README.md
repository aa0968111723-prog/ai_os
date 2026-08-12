# AIOS Public Agent Fuel

General-purpose materials for **all users, AI assistants, and MCP agents**.

**Not limited to any single project (e.g. 挑戰營).**

## Principles

- Lives in **system / global** scope only
- Does **not** occupy any user project quota
- Import via terminal: `npx tsx scripts/import-public-agent-fuel.ts --apply`

## Layout

```
public-agent-fuel/
├── README.md
├── knowledge/          # Markdown knowledge notes
├── prompts/            # catalog.jsonl prompt recipes
└── catalogs/           # optional extra catalogs
```

## After import

A global data table named **公共Agent素材庫** is created/updated.
Agents can query it through existing database / MCP tools.
