import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

// Appends to the audit log. Pass the transaction client when the entry must
// be written together with the change it describes.
export async function writeAudit(
  entry: AuditEntry,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata,
      ip: entry.ip ?? null,
    },
  });
}
