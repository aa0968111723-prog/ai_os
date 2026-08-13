import { describe, expect, it } from "vitest";
import { AGENT_SKILLS, validateSkillContracts } from "./practicalAutonomy";
import { agentToolRegistry } from "./agentToolRegistry";
import { databaseToolAvailability } from "./agentDatabaseTools";

const DATABASE_TOOLS = [
  "database.list",
  "database.schema",
  "database.query",
  "database.row.get",
  "database.row.add",
  "database.row.update",
] as const;

describe("agent database capability layer", () => {
  it("registers real list/schema/query/get/add/update tools", () => {
    for (const id of DATABASE_TOOLS) {
      const tool = agentToolRegistry.get(id);
      expect(typeof tool.handler).toBe("function");
      expect(tool.handlerIdentity.trim().length).toBeGreaterThan(0);
      expect(tool.required).toBe(false);
      expect(tool.requiredContext).toEqual(["userId", "groupId", "projectId"]);
    }
    const add = agentToolRegistry.get("database.row.add");
    const update = agentToolRegistry.get("database.row.update");
    expect(add.access).toBe("WRITE");
    expect(update.access).toBe("WRITE");
    expect(add.confirmation).toBe("always");
    expect(update.confirmation).toBe("always");
    expect(add.idempotency).toBe("effect_receipt");
    expect(add.handlerIdentity).toBe("databaseCommand.executeDatabaseWriteCommand");
    expect(update.handlerIdentity).toBe("databaseCommand.executeDatabaseWriteCommand");
    expect(agentToolRegistry.get("database.list").handlerIdentity).toBe("databaseMcp.listMcpDatabases");
    expect(agentToolRegistry.get("database.query").handlerIdentity).toBe("databaseMcp.queryMcpDatabase");
  });

  it("keeps the record-to-database skill resolvable without making DB a required live gate", () => {
    const skill = AGENT_SKILLS.find((item) => item.id === "record_project_to_database");
    expect(skill).toBeTruthy();
    expect(validateSkillContracts(agentToolRegistry, [skill!])).toEqual([]);
    expect(skill!.requiredCapabilities).toEqual(["database.list", "database.row.add"]);
  });

  it("marks database tools unavailable when DATABASE_URL is missing", () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(databaseToolAvailability()).toEqual({
      available: false,
      reason: "DATABASE_UNAVAILABLE",
      provider: "postgresql",
    });
    if (previous !== undefined) process.env.DATABASE_URL = previous;
  });
});
