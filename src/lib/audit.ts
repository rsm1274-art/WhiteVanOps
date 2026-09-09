import { prisma } from "./db";

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "EXPORT";

export async function audit(
  userId: string,
  action: AuditAction,
  entity: string,
  entityId: string,
  details?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        details: details ? JSON.stringify(details) : null,
      },
    });
  } catch (err) {
    console.error("Audit log write failed:", err);
  }
}
