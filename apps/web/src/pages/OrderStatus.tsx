import { formatGhs, TRACKING_STEPS } from '@david-store/shared';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';

interface Order {
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  deliveryMethod: 'HOME' | 'PICKUP';
  subtotal: number;
  deliveryFee: number;
  total: number;
  estimatedFrom: string | null;
  estimatedTo: string | null;
  items: { productName: string; variantName: string; quantity: number; lineTotal: number; imageUrl: string | null }[];
  deliveryZone: { name: string } | null;
  pickupStation: { name: string; address: string } | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  MOMO: 'Mobile Money',
  CARD: 'Card',
  PAY_ON_DELIVERY: 'Pay on delivery',
  WALLET: 'Store wallet',
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short' });

/** Order confirmation and tracking. The phone number in the link is the customer's proof it is their order. */
export default function OrderStatus() {
  const { number = '' } = useParams();
  const [params] = useSearchParams();
  const phone = params.get('phone') ?? '';
  const isNew = params.get('new') === '1';
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Order>(`/orders/${encodeURIComponent(number)}?phone=${encodeURIComponent(phone)}`)
      .then(setOrder)
      .catch((e: Error) => setError(e.message));
  }, [number, phone]);

  if (error) return <p className="section">{error}</p>;
  if (!order) return <p className="section">Loading your order…</p>;

  const reached = TRACKING_STEPS.findIndex((s) => s.status === order.status);
  const cancelled = order.status === 'CANCELLED' || order.status === 'FAILED';

  return (
    <section className="section">
      <h2>{isNew ? 'Thank you, your order is placed' : `Order ${order.number}`}</h2>
      <p>
        Order number <strong>{order.number}</strong>. Keep it for any questions about your order.
      </p>

      {order.status === 'PENDING_PAYMENT' ? (
        <p className="muted">Waiting for payment.</p>
      ) : cancelled ? (
        <p className="error">This order was cancelled.</p>
      ) : (
        <ol className="tracking">
          {TRACKING_STEPS.map((s, i) => (
            <li key={s.status} className={i <= reached ? 'done' : ''}>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {order.estimatedFrom && order.estimatedTo && !cancelled && (
        <p>
          Expected {order.deliveryMethod === 'PICKUP' ? 'at the pickup station' : 'at your door'} between {day(order.estimatedFrom)} and {day(order.estimatedTo)}.
        </p>
      )}
      {order.pickupStation && (
        <p className="muted">
          Pickup: {order.pickupStation.name}, {order.pickupStation.address}
        </p>
      )}

      <table className="specs" style={{ marginTop: 16 }}>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.productName + i.variantName}>
              <th>
                {i.quantity} × {i.productName} <span className="muted">({i.variantName})</span>
              </th>
              <td>{formatGhs(i.lineTotal)}</td>
            </tr>
          ))}
          <tr>
            <th>Delivery</th>
            <td>{order.deliveryFee ? formatGhs(order.deliveryFee) : 'Free'}</td>
          </tr>
          <tr>
            <th>
              <strong>Total</strong>
            </th>
            <td>
              <strong>{formatGhs(order.total)}</strong>
            </td>
          </tr>
          <tr>
            <th>Payment</th>
            <td>
              {PAYMENT_LABELS[order.paymentMethod] ?? order.paymentMethod} · {order.paymentStatus === 'PAID' ? 'Paid' : 'Not paid yet'}
            </td>
          </tr>
        </tbody>
      </table>
      <p style={{ marginTop: 16 }}>
        <Link to="/" className="btn">
          Continue shopping
        </Link>
      </p>
    </section>
  );
}
