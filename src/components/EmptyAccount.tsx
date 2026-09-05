import { useAccount } from '../account-context';

export function EmptyAccount() {
  const { configured, connect } = useAccount();

  return (
    <div className="empty-panel">
      <h2>Connect Gmail to begin</h2>
      <p>
        Homing Pigeon reads message metadata only and keeps the resulting inventory
        on this computer.
      </p>
      {configured ? (
        <button className="button button-primary" onClick={() => void connect()}>
          Connect Gmail
        </button>
      ) : (
        <p className="notice-error">
          Add your Google OAuth credentials to <code>.env</code>, then restart the
          app.
        </p>
      )}
    </div>
  );
}
