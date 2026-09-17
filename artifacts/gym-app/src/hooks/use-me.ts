import { useAuth } from "@/lib/auth-context";
import type { CurrentUser } from "@workspace/api-client-react";

/**
 * Route guards, sidebar permissions and page-level access checks reuse the
 * already-authenticated user instead of mounting another /api/auth/me query.
 * AuthUser is the generated CurrentUser contract, and AuthProvider seeds the
 * generated query cache for pages that use the generated hook directly.
 */
export function useGetMe(): CurrentUser | undefined {
  const { user } = useAuth();
  return user ?? undefined;
}
