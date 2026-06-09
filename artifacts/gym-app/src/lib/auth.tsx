import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

const TOKEN_KEY = "gym_token";

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

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  token: string | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    token: localStorage.getItem(TOKEN_KEY),
  });

  useEffect(() => {
    // Wire up the token getter for all generated API hooks
    setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setState(s => ({ ...s, isLoading: false }));
      return;
    }

    fetchMe(storedToken).then(user => {
      if (user) {
        setState({ user, token: storedToken, isLoading: false });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setState({ user: null, token: null, isLoading: false });
      }
    });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Login failed");

    localStorage.setItem(TOKEN_KEY, data.token);
    setState({ user: data.user, token: data.token, isLoading: false });
  }, []);

  const logout = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    setState({ user: null, token: null, isLoading: false });
  }, []);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const user = await fetchMe(token);
    if (user) setState(s => ({ ...s, user }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, isAuthenticated: !!state.user, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
