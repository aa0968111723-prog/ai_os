/**
 * SQL-side project-link lookup for custom database rows.
 *
 * Callers supply only tables already authorized by databaseAcl. Each table can
 * use different JSON field keys, so the predicate is an OR of per-table
 * (table_id AND data->>field = projectId) clauses. This avoids loading every
 * row from every visible table into Node just to discard almost all of them.
 */
import { and, eq, or, sql } from "drizzle-orm";
import { db, schema } from "../db";

export interface ProjectLinkTarget {
  tableId: string;
  fieldKeys: string[];
}

export function buildProjectLinkedRowsQuery(
  projectId: string,
  targets: ProjectLinkTarget[],
) {
  const tableClauses = targets
    .filter((target) => target.fieldKeys.length > 0)
    .map((target) => and(
      eq(schema.dataRows.tableId, target.tableId),
      or(...target.fieldKeys.map((fieldKey) =>
        sql`${schema.dataRows.data} ->> ${fieldKey} = ${projectId}`,
      )),
    ));

  if (tableClauses.length === 0) return null;
  return db
    .select({
      id: schema.dataRows.id,
      tableId: schema.dataRows.tableId,
      data: schema.dataRows.data,
    })
    .from(schema.dataRows)
    .where(or(...tableClauses));
}

export async function findProjectLinkedRows(
  projectId: string,
  targets: ProjectLinkTarget[],
) {
  const query = buildProjectLinkedRowsQuery(projectId, targets);
  return query ? query : [];
}
