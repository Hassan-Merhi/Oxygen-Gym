import { createContext, useContext } from "react";
import { AUTH_TOKEN_KEY } from "@/config/env";

export const TOKEN_KEY = AUTH_TOKEN_KEY;

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  email?: string | null;
  role: string;
  status: string;
  permissions: Record<string, boolean>;
  lastLoginAt?: string | null;
}

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
