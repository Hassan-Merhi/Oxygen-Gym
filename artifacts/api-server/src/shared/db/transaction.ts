import { db } from "@workspace/db";

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function withTransaction<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  return db.transaction(work);
}
