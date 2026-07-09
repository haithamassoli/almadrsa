import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Cached grade/class/subject name lookup for bounded join loops — one shared
 * copy for the exam/homework/lesson/library listings that each join a handful
 * of names. A miss hits the DB once, then memoizes into the caller's `cache`.
 */
export async function cachedName<
  Table extends "grades" | "classes" | "subjects",
>(
  ctx: QueryCtx,
  table: Table,
  id: Id<Table>,
  cache: Map<Id<Table>, string>,
): Promise<string> {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  // Grades, classes and subjects all carry `name: string`; TS cannot reduce
  // the generic indexed access to that, hence the contained cast.
  const doc = (await ctx.db.get(table, id)) as { name: string } | null;
  const name = doc?.name ?? "";
  cache.set(id, name);
  return name;
}
