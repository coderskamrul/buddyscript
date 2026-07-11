import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api/endpoints';
import { setAuthFailureHandler } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `loading` starts true: until /auth/me answers we do not know whether there
  // is a session, and rendering the login screen in the meantime would flash it
  // in front of an already-signed-in user on every refresh.
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const clearSession = useCallback(() => {
    setUser(null);
    // Drop every cached feed/comment page so the next user cannot see the
    // previous one's data — including their private posts.
    queryClient.clear();
  }, [queryClient]);

  // The axios interceptor calls this when a refresh attempt finally fails.
  useEffect(() => {
    setAuthFailureHandler(clearSession);
  }, [clearSession]);

  // Restore the session on boot. The tokens live in httpOnly cookies, so the
  // only way to know who we are is to ask the server.
  useEffect(() => {
    let cancelled = false;

    authApi
      .me()
      .then(({ user: current }) => {
        if (!cancelled) setUser(current);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const { user: next } = await authApi.login(credentials);
    setUser(next);
    return next;
  }, []);

  const register = useCallback(async (payload) => {
    const { user: next } = await authApi.register(payload);
    setUser(next);
    return next;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Even if the request fails, drop the client-side session — a user who
      // clicked "log out" must never be left looking at their feed.
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({ user, loading, isAuthenticated: Boolean(user), login, register, logout }),
    [user, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an <AuthProvider>.');
  return context;
}
