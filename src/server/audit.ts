import "server-only";
import { randomUUID } from "node:crypto";
import type { AuditAction, AuditDetail, AuditEntity, SessionUser } from "@/lib/domain";
import { getRepository } from "./repo";
import { currentRequestId } from "./requestContext";

const BLOCKED_KEYS = new Set(["note", "reason", "text", "csv"]);
const VALUE_MAX = 120;

/** Keeps counts and reference values; drops free-text keys and shortens long strings. */
export function cleanAuditDetail(detail: AuditDetail): AuditDetail {
  const clean: AuditDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (BLOCKED_KEYS.has(key.toLowerCase())) continue;
    clean[key] = typeof value === "string" && value.length > VALUE_MAX ? `${value.slice(0, VALUE_MAX - 3)}...` : value;
  }
  return clean;
}

/**
 * Records that the user did something. Call it after the change succeeded. `detail` holds counts and
 * reference values only: never note text, never a raw rejection reason.
 *
 * A failure to write the audit entry is logged and does not fail the request, because the change it
 * describes has already been saved and reporting an error would invite a duplicate.
 */
export async function audit(
  session: SessionUser,
  action: AuditAction,
  entity: AuditEntity,
  entityId: string | null,
  detail: AuditDetail = {},
): Promise<void> {
  try {
    const repo = await getRepository(session);
    await repo.appendAudit({
      id: randomUUID(),
      at: new Date().toISOString(),
      userId: session.id,
      role: session.role,
      action,
      entity,
      entityId,
      detail: cleanAuditDetail(detail),
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "audit_write_failed",
        requestId: currentRequestId(),
        userId: session.id,
        action,
        entity,
        entityId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
