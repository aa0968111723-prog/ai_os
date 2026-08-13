import { and, desc, eq, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { DataField } from "../../shared/databaseFields";
import { lexicalOverlap } from "./intelligenceCore";
import { escapeLikeLiteral } from "./databaseRowSearch";
export { prioritizeAssistantDatabases, mapLabeledDatabaseRowValues } from "./databaseResourceResolver";

export interface AssistantReadableDatabase {
  ref: string;
  id: string;
  name: string;
  fields: DataField[];
  rowCount: number;
  canWrite: boolean;
}
