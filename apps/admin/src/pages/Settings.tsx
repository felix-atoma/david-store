import { formatGhs } from '@david-store/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useSession, type SessionResponse } from '../session';

interface PaymentSettings {
  hubtel: { connected: false } | { connected: true; source: 'dashboard' | 'environment'; apiId: string; apiKey: string; merchantAccount: string };
  canSaveKeys: boolean;
  callbackUrl: string;
  returnUrl: string;
}

interface Check {
  ok: boolean;
  message: string;
}

interface TestResult extends Check {
  keys: Check;
  statusChecks: Check;
}

export default function Settings() {
  const { user } = useSession();
  return (
    <>
      <h1>Settings</h1>
      <div className="stack" style={{ gap: 20 }}>
        <AccountSettings />
        {user?.role === 'SUPER_ADMIN' ? <HubtelSettings /> : <p className="muted">Only the store owner can change payment settings.</p>}
      </div>
    </>
  );
}

/** Every admin user can change their own password; other devices are signed out. */
function AccountSettings() {
  const { user, refreshSession } = useSession();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const tooShort = form.next.length > 0 && form.next.length < 10;
  const needsNumber = form.next.length > 0 && !(/[A-Za-z]/.test(form.next) && /\d/.test(form.next));
  const mismatch = form.confirm.length > 0 && form.confirm !== form.next;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tooShort || needsNumber || mismatch) return;
    setBusy(true);
    setError('');
    setDone(false);
    try {
      const session = await api<SessionResponse>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      });
      refreshSession(session);
      setForm({ current: '', next: '', confirm: '' });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>Your account</h2>
      <p className="muted">
        Signed in as <strong>{user?.email}</strong>
      </p>
      <form className="stack" onSubmit={submit} style={{ maxWidth: 420 }}>
        <h3 style={{ margin: 0 }}>Change password</h3>
        <label>
          Current password
          <input type={show ? 'text' : 'password'} value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required autoComplete="current-password" />
        </label>
        <label>
          New password
          <input type={show ? 'text' : 'password'} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required minLength={10} autoComplete="new-password" />
          <span className={tooShort || needsNumber ? 'error' : 'muted'} style={{ fontSize: 13 }}>
            At least 10 characters, with letters and at least one number.
          </span>
        </label>
        <label>
          Repeat new password
          <input type={show ? 'text' : 'password'} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required autoComplete="new-password" />
          {mismatch && <span className="error" style={{ fontSize: 13 }}>The two new passwords don't match.</span>}
        </label>
        <label className="check">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
        </label>
        <button className="btn" disabled={busy || tooShort || needsNumber || mismatch}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
        {done && <p className="ok">Password changed. You stay signed in here; every other device has been signed out.</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function HubtelSettings() {
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [form, setForm] = useState({ apiId: '', apiKey: '', merchantAccount: '' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);
  const [amount, setAmount] = useState(100);

  const load = useCallback(
    () =>
      api<PaymentSettings>('/admin/settings/payments')
        .then((s) => {
          setSettings(s);
          if (s.hubtel.connected) setForm({ apiId: s.hubtel.apiId, apiKey: '', merchantAccount: s.hubtel.merchantAccount });
          setEditing(!s.hubtel.connected);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run('save', async () => {
      const s = await api<PaymentSettings>('/admin/settings/payments/hubtel', {
        method: 'PUT',
        body: JSON.stringify({ apiId: form.apiId, apiKey: form.apiKey || undefined, merchantAccount: form.merchantAccount }),
      });
      setSettings(s);
      setEditing(false);
      setForm((f) => ({ ...f, apiKey: '' }));
      setTest(await api<TestResult>('/admin/settings/payments/hubtel/test', { method: 'POST' }));
    });
  };

  if (!settings) return <p className="muted">{error || 'Loading…'}</p>;
  const h = settings.hubtel;

  return (
    <div className="panel" style={{ maxWidth: 760 }}>
      <h2 style={{ marginTop: 0 }}>Payments: Hubtel</h2>
      <p>
        Status:{' '}
        {h.connected ? (
          <strong className="ok">Keys saved{h.source === 'environment' ? ' (from server settings)' : ''}</strong>
        ) : (
          <strong className="error">Not connected</strong>
        )}
        {!h.connected && <span className="muted"> · customers can only pay on delivery until keys are added.</span>}
      </p>

      {h.connected && !editing && (
        <table className="table" style={{ marginBottom: 12 }}>
          <tbody>
            <tr>
              <th>API ID (Client ID)</th>
              <td>{h.apiId}</td>
            </tr>
            <tr>
              <th>API key (Client Secret)</th>
              <td>{h.apiKey}</td>
            </tr>
            <tr>
              <th>POS Sales ID</th>
              <td>{h.merchantAccount}</td>
            </tr>
          </tbody>
        </table>
      )}

      {editing ? (
        settings.canSaveKeys ? (
          <form className="stack" onSubmit={save}>
            <label>
              API ID (Client ID)
              <input value={form.apiId} onChange={(e) => setForm({ ...form, apiId: e.target.value })} required autoComplete="off" />
            </label>
            <label>
              API key (Client Secret){h.connected && <span className="muted"> · leave empty to keep the saved key</span>}
              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} required={!h.connected} autoComplete="new-password" />
            </label>
            <label>
              POS Sales ID (merchant account number)
              <input value={form.merchantAccount} onChange={(e) => setForm({ ...form, merchantAccount: e.target.value.replace(/\D/g, '') })} required inputMode="numeric" />
            </label>
            <div className="inline-form">
              <button className="btn" disabled={busy === 'save'}>
                {busy === 'save' ? 'Saving…' : 'Save and test'}
              </button>
              {h.connected && (
                <button type="button" className="link" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
            </div>
            <p className="muted">Find these in the Hubtel merchant dashboard under API keys. The key is stored encrypted and never shown again.</p>
          </form>
        ) : (
          <p className="error">The server has no SETTINGS_ENCRYPTION_KEY, so keys can't be saved here yet.</p>
        )
      ) : (
        <div className="inline-form">
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Change keys
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={busy === 'test'}
            onClick={() => run('test', async () => setTest(await api<TestResult>('/admin/settings/payments/hubtel/test', { method: 'POST' })))}
          >
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </button>
          {h.connected && h.source === 'dashboard' && (
            <button
              type="button"
              className="link"
              onClick={() =>
                confirm('Remove the Hubtel keys? Customers will only be able to pay on delivery.') &&
                run('clear', async () => {
                  await api('/admin/settings/payments/hubtel', { method: 'DELETE' });
                  setTest(null);
                  await load();
                })
              }
            >
              Remove keys
            </button>
          )}
        </div>
      )}

      {test && (
        <ul className="checks">
          <li className={test.keys.ok ? 'ok' : 'error'}>
            {test.keys.ok ? '✓' : '✗'} API keys: {test.keys.message}
          </li>
          <li className={test.statusChecks.ok ? 'ok' : 'error'}>
            {test.statusChecks.ok ? '✓' : '✗'} Payment confirmation: {test.statusChecks.message}
          </li>
        </ul>
      )}
      {error && <p className="error">{error}</p>}

      {h.connected && (
        <>
          <h3>Try a real payment</h3>
          <p className="muted">Pays a small real amount by MoMo or card through Hubtel and marks a test order as paid. Test orders are left out of sales reports.</p>
          <div className="inline-form">
            <select value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ flex: '0 0 auto' }}>
              {[100, 200, 500, 1000].map((a) => (
                <option key={a} value={a}>
                  {formatGhs(a)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={busy === 'pay'}
              onClick={() =>
                run('pay', async () => {
                  const r = await api<{ checkoutUrl: string }>('/admin/settings/payments/hubtel/test-payment', { method: 'POST', body: JSON.stringify({ amount }) });
                  window.open(r.checkoutUrl, '_blank', 'noopener');
                })
              }
            >
              {busy === 'pay' ? 'Opening Hubtel…' : `Pay ${formatGhs(amount)} now`}
            </button>
          </div>
        </>
      )}

      <h3>Give these to Hubtel</h3>
      <table className="table">
        <tbody>
          <tr>
            <th>Callback URL</th>
            <td>
              <code>{settings.callbackUrl}</code>
            </td>
          </tr>
          <tr>
            <th>Return URL</th>
            <td>
              <code>{settings.returnUrl}</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        Hubtel only answers payment status checks from IP addresses it has whitelisted. Send Hubtel the server's outbound IP addresses (Render dashboard › david-store-api › Connect › Outbound) and ask them to whitelist them for the
        transaction status API.
      </p>
    </div>
  );
}
