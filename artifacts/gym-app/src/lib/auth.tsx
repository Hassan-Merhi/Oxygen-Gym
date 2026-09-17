import React, { useState, useEffect, useCallback } from "react";
import { getGetMeQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/config/env";
import { AuthContext, TOKEN_KEY } from "./auth-context";
import type { AuthState } from "./auth-context";

async function fetchMe(token: string) {
  try {
    const res = await fetch(apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const meQueryKey = getGetMeQueryKey();
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    token: localStorage.getItem(TOKEN_KEY),
  });

  useEffect(() => {
    setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      queryClient.removeQueries({ queryKey: meQueryKey, exact: true });
      setState(s => ({ ...s, isLoading: false }));
      return;
    }

    fetchMe(storedToken).then(user => {
      if (user) {
        // Route guards and pages both need the current user. Seed the shared query
        // cache from this single auth bootstrap request so mounting the protected
        // app shell cannot immediately issue a second /api/auth/me read.
        queryClient.setQueryData(meQueryKey, user);
        setState({ user, token: storedToken, isLoading: false });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        queryClient.removeQueries({ queryKey: meQueryKey, exact: true });
        setState({ user: null, token: null, isLoading: false });
      }
    });
  }, [queryClient]); // meQueryKey is a stable generated key

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(apiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Login failed");

    localStorage.setItem(TOKEN_KEY, data.token);
    queryClient.setQueryData(meQueryKey, data.user);
    setState({ user: data.user, token: data.token, isLoading: false });
  }, [queryClient]);

  const logout = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      fetch(apiUrl("/api/auth/logout"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    queryClient.removeQueries({ queryKey: meQueryKey, exact: true });
    setState({ user: null, token: null, isLoading: false });
  }, [queryClient]);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const user = await fetchMe(token);
    if (user) {
      queryClient.setQueryData(meQueryKey, user);
      setState(s => ({ ...s, user }));
    }
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ ...state, isAuthenticated: !!state.user, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
