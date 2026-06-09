import type { Request } from "express";
import { db } from "@workspace/db";
import { activityLogsTable } from "@workspace/db/schema";

export async function logActivity(
  req: Request,
  action: string,
  entity: string,
  entityId?: number,
  details?: Record<string, unknown>
) {
  try {
    const user = (req as unknown as { dbUser?: { id: number; name?: string } }).dbUser;
    await db.insert(activityLogsTable).values({
      userId: user?.id,
      userName: user?.name ?? "System",
      action,
      entity,
      entityId,
      details: details ?? {},
    });
  } catch {
    // non-fatal
  }
}
