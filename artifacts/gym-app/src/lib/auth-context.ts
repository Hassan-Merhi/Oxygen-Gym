import { createContext, useContext } from "react";
import type { CurrentUser } from "@workspace/api-client-react";
import { AUTH_TOKEN_KEY } from "@/config/env";

export const TOKEN_KEY = AUTH_TOKEN_KEY;

/**
 * Authentication and generated API consumers share the exact same current-user
 * contract. Keeping one source of truth prevents permission/role drift while the
 * auth provider seeds the generated /api/auth/me query cache.
 */
export type AuthUser = CurrentUser;

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  token: string | null;
}

export interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
