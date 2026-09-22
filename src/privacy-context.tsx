import { createContext, useContext, useState, type ReactNode } from 'react';

const PrivacyContext = createContext<{
  enabled: boolean;
  toggle: () => void;
} | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem('mailroom.privacyView') === 'true',
  );

  function toggle() {
    const next = !enabled;
    localStorage.setItem('mailroom.privacyView', String(next));
    setEnabled(next);
  }

  return (
    <PrivacyContext.Provider value={{ enabled, toggle }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  const context = useContext(PrivacyContext);
  if (!context) throw new Error('usePrivacy must be used inside PrivacyProvider.');
  return context;
}
