import { describe, expect, it } from "vitest";
import { buildProjectLinkedRowsQuery } from "./databaseProjectLinks";

describe("project-linked database row query", () => {
  it("filters in PostgreSQL by authorized table and each project field", () => {
    const query = buildProjectLinkedRowsQuery(
      "00000000-0000-4000-8000-000000000001",
      [
        {
          tableId: "00000000-0000-4000-8000-000000000002",
          fieldKeys: ["project", "backup_project"],
        },
        {
          tableId: "00000000-0000-4000-8000-000000000003",
          fieldKeys: ["owner_project"],
        },
      ],
    );
    const built = query?.toSQL();
    expect(built).toBeDefined();
    expect(built!.sql).toContain('"data_rows"."table_id" =');
    expect(built!.sql.match(/->> /g)).toHaveLength(3);
    expect(built!.params).toContain("project");
    expect(built!.params).toContain("backup_project");
    expect(built!.params).toContain("owner_project");
  });

  it("returns no query for an empty target set", () => {
    expect(buildProjectLinkedRowsQuery("project", [])).toBeNull();
    expect(buildProjectLinkedRowsQuery("project", [{ tableId: "table", fieldKeys: [] }])).toBeNull();
  });
});
