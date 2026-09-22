import { useState } from 'react';
import { useSession } from '../session-context';
import { ChevronDown } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import packageMetadata from '../../package.json';
import homingPigeonLogo from '../assets/homing-pigeon-logo.png';
import { useAccount } from '../account-context';
import { usePrivacy } from '../privacy-context';

const navigation = [
  { to: '/fetch', label: 'Fetch' },
  { to: '/messages', label: 'Messages' },
  { to: '/senders', label: 'Senders' },
  { to: '/domains', label: 'Domains' },
];

export function Layout() {
  const { enabled: privacyEnabled, toggle: togglePrivacy } = usePrivacy();
  const { logout } = useSession();
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logout();
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : 'Could not log out.');
      setLoggingOut(false);
    }
  }
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
          <img
            className="brand-logo"
            src={homingPigeonLogo}
            alt=""
            aria-hidden="true"
          />
          <span>Homing Pigeon</span>
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
        {logoutError ? <div className="error-banner" role="alert">{logoutError}</div> : null}
        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        <Outlet />
      </main>

      <footer className="app-footer">
        <button className="text-button" disabled={loggingOut} onClick={() => void handleLogout()}>
          {loggingOut ? 'Logging out…' : 'Log out'}
        </button>
        <button
          className="text-button privacy-toggle"
          type="button"
          aria-pressed={privacyEnabled}
          onClick={togglePrivacy}
          title="Redact sender addresses, message subjects, and domains in the main tables"
        >
          Privacy view: {privacyEnabled ? 'On' : 'Off'}
        </button>
        <span className="app-footer-version value">
          v {packageMetadata.version}
        </span>
      </footer>
    </div>
  );
}
