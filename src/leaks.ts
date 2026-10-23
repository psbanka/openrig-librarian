// Counts stored values that the redaction policy would still change. Each one is a leak.
// It prints nothing itself; callers report counts, never the values.
import type { Database } from "bun:sqlite";
import { redact } from "./redact";

const FIELDS: Array<[table: string, columns: string[]]> = [
  ["items", ["ref", "title", "state"]],
  ["chunks", ["title", "text"]],
  ["sessions", ["id", "cwd", "parent", "seat", "model", "commits"]],
  ["merges", ["merged_as"]],
];

export function leakCounts(db: Database): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [table, columns] of FIELDS)
    for (const column of columns) {
      let leaks = 0;
      const rows = db.query(`select ${column} as value from ${table} where ${column} is not null`);
      for (const { value } of rows.iterate() as Iterable<{ value: unknown }>)
        if (redact(String(value)) !== String(value)) leaks++;
      counts[`${table}.${column}`] = leaks;
    }
  return counts;
}
