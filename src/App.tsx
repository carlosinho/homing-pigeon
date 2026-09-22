import { Navigate, Route, Routes } from 'react-router-dom';
import { AccountProvider } from './account-context';
import { PrivacyProvider } from './privacy-context';
import { useSession } from './session-context';
import { LoginPage } from './pages/LoginPage';
import { Layout } from './components/Layout';
import { DomainsPage } from './pages/DomainsPage';
import { FetchPage } from './pages/FetchPage';
import { MessagesPage } from './pages/MessagesPage';
import { SendersPage } from './pages/SendersPage';

export default function App() {
  const { session, error, refresh } = useSession();
  if (!session) {
    return (
      <main className="login-shell">
        <div className="login-panel">
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button className="text-button" onClick={() => void refresh()}>Retry</button>
            </>
          ) : <p role="status">Loading…</p>}
        </div>
      </main>
    );
  }
  if (!session.authenticated) return <LoginPage />;
  return (
    <AccountProvider>
      <PrivacyProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/fetch" replace />} />
            <Route path="fetch" element={<FetchPage />} />
            <Route path="messages" element={<MessagesPage />} />
            <Route path="senders" element={<SendersPage />} />
            <Route path="domains" element={<DomainsPage />} />
            <Route path="*" element={<Navigate to="/fetch" replace />} />
          </Route>
        </Routes>
      </PrivacyProvider>
    </AccountProvider>
  );
}
