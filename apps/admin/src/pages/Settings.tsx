import { formatGhs } from '@david-store/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';

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
  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <>
        <h1>Settings</h1>
        <p className="muted">Only the store owner can change payment settings.</p>
      </>
    );
  }
  return (
    <>
      <h1>Settings</h1>
      <HubtelSettings />
    </>
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
