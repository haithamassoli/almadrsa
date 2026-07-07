import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { actorType } from "./validators";

/**
 * Audit trail. Action naming convention (dot-scoped, past-tense-free):
 *   "code.login" · "code.login_failed" · "code.pin_set" · "code.regenerate"
 *   "code.revoke" · "staff.create" · "staff.disable" · "staff.enable"
 *
 * actorId semantics (see schema): staff → Better Auth user id · student →
 * accessCode id · system → "system" (or "unknown" for unattributable events).
 * Never put secrets or plaintext codes in `meta` — hash prefixes only.
 */
export type AuditEntry = {
  actorType: "staff" | "student" | "system";
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
};

/** Append an audit row from inside any mutation. */
export async function logAudit(
  ctx: MutationCtx,
  entry: AuditEntry,
): Promise<void> {
  await ctx.db.insert("auditLog", {
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    meta: entry.meta,
    ip: entry.ip,
  });
}

/** Audit writer for actions (which cannot touch the DB directly). */
export const record = internalMutation({
  args: {
    actorType,
    actorId: v.string(),
    action: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    meta: v.optional(v.record(v.string(), v.any())),
    ip: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await logAudit(ctx, args);
    return null;
  },
});
