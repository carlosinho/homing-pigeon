import { ChevronDown } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAccount } from '../account-context';

const navigation = [
  { to: '/fetch', label: 'Fetch' },
  { to: '/messages', label: 'Messages' },
  { to: '/senders', label: 'Senders' },
  { to: '/domains', label: 'Domains' },
];

export function Layout() {
  const {
    accounts,
    activeAccount,
    selectAccount,
    configured,
    connect,
    loading,
    error,
  } = useAccount();

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/fetch" className="brand">
          Mailroom
        </NavLink>

        <nav className="route-nav" aria-label="Main navigation">
          {navigation.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `route-link ${isActive ? 'active' : ''}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mailbox">
          {loading ? (
            <div className="mailbox-loading" aria-label="Loading mailboxes" />
          ) : accounts.length ? (
            <label className="mailbox-select">
              <span className="sr-only">Active Gmail account</span>
              <select
                value={activeAccount?.id || ''}
                onChange={(event) => selectAccount(Number(event.target.value))}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.email}{account.connected ? '' : ' (disconnected)'}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          ) : (
            <span className="mailbox-empty">No mailbox connected</span>
          )}
          {configured ? (
            <button className="text-button" onClick={() => void connect()}>
              {accounts.length ? 'Connect another' : 'Connect Gmail'}
            </button>
          ) : null}
        </div>
      </header>

      <main className="main-content">
        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        <Outlet />
      </main>
    </div>
  );
}
