import { useState, type FormEvent } from 'react';
import homingPigeonLogo from '../assets/homing-pigeon-logo.png';
import { useSession } from '../session-context';

export function LoginPage() {
  const { login } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login(password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not log in.');
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="login-shell">
    <form className="login-panel" onSubmit={(event) => void submit(event)}>
      <img className="login-logo" src={homingPigeonLogo} alt="" />
      <h1>Homing Pigeon</h1>
      <p>Log in to your local mail inventory.</p>
      <label htmlFor="login-password">Password</label>
      <input id="login-password" type="password" autoComplete="current-password"
        autoFocus required maxLength={1024} value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-describedby={error ? 'login-error' : undefined} />
      {error ? <p className="error-banner" id="login-error" role="alert">{error}</p> : null}
      <button className="button" type="submit" disabled={submitting}>
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  </main>;
}
