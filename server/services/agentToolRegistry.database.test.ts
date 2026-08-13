import { describe, expect, it } from "vitest";
import { AGENT_SKILLS, validateSkillContracts } from "./practicalAutonomy";
import { agentToolRegistry } from "./agentToolRegistry";

describe("agent database capability bridge", () => {
  it("registers list/query/write tools that reuse existing ACL + write command", () => {
    const list = agentToolRegistry.get("database.list");
    const query = agentToolRegistry.get("database.query");
    const write = agentToolRegistry.get("database.add_row");
    expect(list.access).toBe("READ");
    expect(query.access).toBe("READ");
    expect(write.access).toBe("WRITE");
    expect(write.confirmation).toBe("always");
    expect(list.required).toBe(false);
    expect(query.required).toBe(false);
    expect(write.required).toBe(false);
    expect(list.handlerIdentity).toBe("databaseMcp.listMcpDatabases");
    expect(query.handlerIdentity).toBe("databaseMcp.queryMcpDatabase");
    expect(write.handlerIdentity).toBe("databaseCommand.executeDatabaseWriteCommand");
  });

  it("keeps the record-to-database skill resolvable without making it a required live gate", () => {
    const skill = AGENT_SKILLS.find((item) => item.id === "record_project_to_database");
    expect(skill).toBeTruthy();
    expect(validateSkillContracts(agentToolRegistry, [skill!])).toEqual([]);
    expect(skill!.requiredCapabilities).toEqual(["database.list", "database.add_row"]);
  });
});
