import {
  Download,
  Inbox,
  MailSearch,
  Menu,
  Send,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAccount } from '../account-context';

const navigation = [
  { to: '/fetch', label: 'Fetch', detail: 'Bring mail in', icon: Download },
  { to: '/messages', label: 'Messages', detail: 'Inspect the rows', icon: MailSearch },
  { to: '/senders', label: 'Senders', detail: 'Find the volume', icon: Users },
];

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const {
    accounts,
    activeAccount,
    selectAccount,
    configured,
    connect,
    loading,
  } = useAccount();

  return (
    <div className="app-shell">
      <button
        className="mobile-menu-button"
        aria-label="Open navigation"
        onClick={() => setMobileOpen(true)}
      >
        <Menu size={20} />
      </button>

      {mobileOpen ? (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <Send size={19} strokeWidth={2.2} />
          </div>
          <div>
            <span className="brand-name">Mailroom</span>
            <span className="brand-caption">Gmail inventory</span>
          </div>
          <button
            className="sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <nav className="route-nav" aria-label="Main navigation">
          <div className="route-line" />
          {navigation.map(({ to, label, detail, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `route-link ${isActive ? 'active' : ''}`}
            >
              <span className="route-node">
                <Icon size={16} />
              </span>
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="account-dock">
          <div className="account-label">
            <Inbox size={15} /> Mailbox
          </div>
          {loading ? (
            <div className="account-loading" />
          ) : accounts.length ? (
            <select
              aria-label="Active Gmail account"
              value={activeAccount?.id || ''}
              onChange={(event) => selectAccount(Number(event.target.value))}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email}{account.connected ? '' : ' (disconnected)'}
                </option>
              ))}
            </select>
          ) : (
            <p>No mailbox connected</p>
          )}
          {configured ? (
            <button className="text-button" onClick={() => void connect()}>
              {accounts.length ? 'Connect another' : 'Connect Gmail'}
            </button>
          ) : null}
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
