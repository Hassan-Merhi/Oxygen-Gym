import { usersTable } from "@workspace/db/schema";

type GymUser = typeof usersTable.$inferSelect;

declare global {
  namespace Express {
    interface Request {
      __gymproUser?: GymUser;
      __gymproUserId?: number;
      __gymproUserName?: string;
    }
  }
}

export {};
