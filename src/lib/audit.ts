/**
 * Audit logging utility.
 * Records admin actions for accountability and debugging.
 */
import { prisma } from "./db";
import { log } from "@/lib/log";

type AuditAction =
  | "approve_request"
  | "deny_request"
  | "cancel_request"
  | "retry_request"
  | "blocklist_queue"
  | "create_user"
  | "update_user"
  | "delete_user"
  | "add_notification"
  | "remove_notification"
  | "update_settings"
  | "login"
  // (M2-03) Telemetry: fired when an admin opens the Diagnose modal for a
  // down service. The detail captures the errorClass taxonomy so we can
  // decide post-beta whether a Phase-2 Restart action is worth building.
  | "service_diagnose_opened"
  | "remove_orphan";

export async function logAudit(
  userId: string | null | undefined,
  action: AuditAction,
  target?: { type: string; id: string },
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        targetType: target?.type,
        targetId: target?.id,
        detail: detail ? JSON.stringify(detail) : undefined,
      },
    });
  } catch (err) {
    log.error("audit: failed to write audit log entry", { err, action, target });
    // Audit logging should never break the calling operation
  }
}
