import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setAccessToken } from './api';

export interface AdminUser {
  id: string;
  name: string;
  email: string | null;
  role: 'SUPER_ADMIN' | 'STAFF' | 'CUSTOMER' | 'VENDOR' | 'RIDER';
  permissions: string[];
}

export interface SessionResponse {
  accessToken: string;
  user: AdminUser;
}

const ADMIN_ROLES: AdminUser['role'][] = ['SUPER_ADMIN', 'STAFF'];

interface Session {
  user: AdminUser | null;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Adopt a session the API just issued, e.g. after a password change. */
  refreshSession: (s: SessionResponse) => void;
}

const SessionContext = createContext<Session | null>(null);

/** The access token lives only in memory; the httpOnly refresh cookie restores it on reload. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [ready, setReady] = useState(false);

  const accept = useCallback((s: SessionResponse) => {
    if (!ADMIN_ROLES.includes(s.user.role)) {
      setAccessToken(null);
      throw new Error('This account cannot use the admin dashboard.');
    }
    setAccessToken(s.accessToken);
    setUser(s.user);
  }, []);

  useEffect(() => {
    api<SessionResponse>('/auth/refresh', { method: 'POST' })
      .then(accept)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, [accept]);

  // Refresh a little before the 15-minute access token runs out.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      api<SessionResponse>('/auth/refresh', { method: 'POST' }).then(accept).catch(() => setUser(null));
    }, 12 * 60_000);
    return () => clearInterval(t);
  }, [user, accept]);

  const login = async (identifier: string, password: string) => {
    accept(await api<SessionResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) }));
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  };

  return <SessionContext.Provider value={{ user, ready, login, logout, refreshSession: accept }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext)!;
