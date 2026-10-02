import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';

interface VerifyResult {
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  orderNumber: string;
}

const MAX_CHECKS = 20;

/**
 * Hubtel sends the customer back here. A MoMo approval can take a minute to settle,
 * so we keep asking the API (which asks Hubtel) for a while before giving up.
 */
export default function CheckoutComplete() {
  const [params] = useSearchParams();
  const ref = params.get('ref') ?? '';
  const cancelled = params.get('cancelled') === '1';
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    if (!ref || result?.status === 'SUCCESS' || checks >= MAX_CHECKS) return;
    const t = setTimeout(
      () => {
        api<VerifyResult>(`/payments/${encodeURIComponent(ref)}/verify`, { method: 'POST' })
          .then(setResult)
          .catch(() => undefined)
          .finally(() => setChecks((c) => c + 1));
      },
      checks === 0 ? 0 : 3000,
    );
    return () => clearTimeout(t);
  }, [ref, checks, result?.status]);

  if (result?.status === 'SUCCESS') {
    return (
      <section className="section">
        <h2>Payment received</h2>
        <p>
          Thank you. Order <strong>{result.orderNumber}</strong> is placed. We'll send updates by SMS and email.
        </p>
        <Link to="/" className="btn">
          Continue shopping
        </Link>
      </section>
    );
  }

  const gaveUp = checks >= MAX_CHECKS;
  return (
    <section className="section">
      <h2>{cancelled && gaveUp ? 'Payment cancelled' : 'Confirming your payment…'}</h2>
      <p className="muted">
        {gaveUp
          ? 'We have not received confirmation yet. If money left your account, it will be matched to your order automatically. Contact support if this persists.'
          : 'If you are paying by MoMo, approve the prompt on your phone. This page updates on its own.'}
      </p>
    </section>
  );
}
