import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import type { Account } from './types';

type AccountContextValue = {
  accounts: Account[];
  activeAccount: Account | null;
  configured: boolean;
  loading: boolean;
  error: string;
  selectAccount: (id: number) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<number | null>(() => {
    const stored = localStorage.getItem('mailroom.activeAccount');
    return stored ? Number(stored) : null;
  });
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const result = await api.authStatus();
      setAccounts(result.accounts);
      setConfigured(result.configured);
      setError('');
      setActiveId((current) => {
        if (current && result.accounts.some((account) => account.id === current)) {
          return current;
        }
        const connected = result.accounts.find((account) => account.connected);
        return connected?.id || result.accounts[0]?.id || null;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reach the app.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (activeId) localStorage.setItem('mailroom.activeAccount', String(activeId));
  }, [activeId]);

  const activeAccount =
    accounts.find((account) => account.id === activeId) || null;

  const value = useMemo<AccountContextValue>(
    () => ({
      accounts,
      activeAccount,
      configured,
      loading,
      error,
      selectAccount: setActiveId,
      connect: async () => {
        const { url } = await api.authorizationUrl();
        window.location.assign(url);
      },
      disconnect: async () => {
        if (!activeAccount) return;
        await api.disconnect(activeAccount.id);
        await refresh();
      },
      refresh,
    }),
    [accounts, activeAccount, configured, loading, error, refresh],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const context = useContext(AccountContext);
  if (!context) throw new Error('useAccount must be used inside AccountProvider.');
  return context;
}
