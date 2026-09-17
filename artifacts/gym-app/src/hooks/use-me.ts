import { useAuth } from "@/lib/auth-context";
import type { CurrentUser } from "@workspace/api-client-react";

/**
 * Route guards, sidebar permissions and page-level access checks should reuse the
 * already-authenticated user instead of mounting another /api/auth/me query.
 * Pages that import the generated useGetMe hook directly still receive the same
 * value because AuthProvider seeds the generated query cache after its bootstrap.
 */
export function useGetMe(): CurrentUser | undefined {
  const { user } = useAuth();
  return user ? (user as CurrentUser) : undefined;
}
