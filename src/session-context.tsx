import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, SESSION_EXPIRED_EVENT, type SessionStatus } from './api';

type SessionContextValue = {
  session: SessionStatus | null;
  error: string;
  refresh: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
};
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const clearSession = useCallback(() => {
    revision.current += 1;
    setSession({ authenticated: false, expiresAt: null });
    setError('');
  }, []);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const result = await api.session();
      if (current === revision.current) {
        setSession(result);
        setError('');
      }
    } catch (caught) {
      if (current === revision.current) setError(caught instanceof Error ? caught.message : 'Could not reach the app.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'mailroom.logout') clearSession();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, clearSession);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, clearSession);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [clearSession, refresh]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    const timer = window.setTimeout(clearSession, Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session, clearSession]);

  return <SessionContext.Provider value={{
    session, error, refresh,
    login: async (password) => {
      revision.current += 1;
      const result = await api.login(password);
      setSession(result);
      setError('');
    },
    logout: async () => {
      await api.logout();
      clearSession();
      localStorage.setItem('mailroom.logout', String(Date.now()));
    },
  }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider.');
  return context;
}
