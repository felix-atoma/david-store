import { formatGhs } from '@david-store/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';

interface Zone {
  id: string;
  name: string;
  areas: string[];
  fee: number;
  minDays: number;
  maxDays: number;
}

interface Station {
  id: string;
  name: string;
  address: string;
  openingHours: string | null;
  fee: number;
  zone: { minDays: number; maxDays: number };
}

interface Options {
  zones: Zone[];
  pickupStations: Station[];
  freeDeliveryThreshold: number;
  payOnDeliveryMax: number;
  onlinePayments: boolean;
}

interface Item {
  variantId: string;
  name: string;
  variantName: string;
  price: number;
  image: string | null;
  stock: number;
  freeDelivery: boolean;
}

type Payment = 'MOMO' | 'CARD' | 'PAY_ON_DELIVERY';

const REGIONS = ['Greater Accra', 'Ashanti', 'Central', 'Eastern', 'Western', 'Western North', 'Volta', 'Oti', 'Northern', 'Savannah', 'North East', 'Upper East', 'Upper West', 'Bono', 'Bono East', 'Ahafo'];

/** "0241234567" or "+233 24 123 4567" → "+233241234567"; anything else is returned unchanged for the API to reject. */
const normalisePhone = (raw: string) => {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(digits)) return `+233${digits.slice(1)}`;
  if (/^233\d{9}$/.test(digits)) return `+${digits}`;
  return digits;
};

/** One-page checkout: contact, delivery and payment on one screen, as the spec asks. */
export default function Checkout() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const variantId = params.get('variant') ?? '';
  const qty = Math.max(1, Math.min(20, Number(params.get('qty') ?? 1)));

  const [item, setItem] = useState<Item | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [quantity, setQuantity] = useState(qty);
  const [form, setForm] = useState({ name: '', phone: '', email: '', region: 'Greater Accra', city: '', area: '', street: '', landmark: '', gpsAddress: '', note: '' });
  const [method, setMethod] = useState<'HOME' | 'PICKUP'>('HOME');
  const [zoneId, setZoneId] = useState('');
  const [stationId, setStationId] = useState('');
  const [payment, setPayment] = useState<Payment>('MOMO');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Options>('/checkout/options')
      .then((o) => {
        setOptions(o);
        setZoneId(o.zones[0]?.id ?? '');
        setStationId(o.pickupStations[0]?.id ?? '');
        if (!o.onlinePayments) setPayment('PAY_ON_DELIVERY');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Without a cart yet, the item comes from the variant in the link.
  useEffect(() => {
    if (!variantId) return;
    api<Item>(`/checkout/variant/${encodeURIComponent(variantId)}`)
      .then(setItem)
      .catch(() => setError('This item is no longer available.'));
  }, [variantId]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const totals = useMemo(() => {
    if (!item || !options) return null;
    const subtotal = item.price * quantity;
    const zone = options.zones.find((z) => z.id === zoneId);
    const station = options.pickupStations.find((s) => s.id === stationId);
    const baseFee = method === 'HOME' ? zone?.fee ?? 0 : station?.fee ?? 0;
    const free = item.freeDelivery || (options.freeDeliveryThreshold > 0 && subtotal >= options.freeDeliveryThreshold);
    const deliveryFee = free ? 0 : baseFee;
    const days = method === 'HOME' ? zone : station?.zone;
    return { subtotal, deliveryFee, total: subtotal + deliveryFee, days };
  }, [item, options, quantity, method, zoneId, stationId]);

  const podTooBig = Boolean(options && totals && options.payOnDeliveryMax > 0 && totals.total > options.payOnDeliveryMax);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    setBusy(true);
    setError('');
    const phone = normalisePhone(form.phone);
    try {
      const order = await api<{ number: string; status: string }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ variantId: item.variantId, quantity }],
          name: form.name,
          phone,
          email: form.email || undefined,
          deliveryMethod: method,
          zoneId: method === 'HOME' ? zoneId : undefined,
          pickupStationId: method === 'PICKUP' ? stationId : undefined,
          address:
            method === 'HOME'
              ? { region: form.region, city: form.city, area: form.area, street: form.street || undefined, landmark: form.landmark || undefined, gpsAddress: form.gpsAddress || undefined }
              : undefined,
          paymentMethod: payment,
          note: form.note || undefined,
        }),
      });
      if (payment === 'PAY_ON_DELIVERY') {
        navigate(`/order/${order.number}?phone=${encodeURIComponent(phone)}&new=1`);
        return;
      }
      const { checkoutUrl } = await api<{ checkoutUrl: string }>(`/payments/orders/${order.number}/checkout`, { method: 'POST' });
      window.location.href = checkoutUrl;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (!variantId) {
    return (
      <section className="section">
        <h2>Your basket is empty</h2>
        <Link to="/" className="btn">
          Start shopping
        </Link>
      </section>
    );
  }
  if (!item || !options || !totals) return <p className="section">{error || 'Loading checkout…'}</p>;

  return (
    <form className="checkout" onSubmit={submit}>
      <div>
        <section className="section">
          <h2>1. Your details</h2>
          <div className="fields">
            <label>
              Full name
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} required minLength={2} autoComplete="name" />
            </label>
            <label>
              Phone number
              <input value={form.phone} onChange={(e) => set({ phone: e.target.value })} required inputMode="tel" placeholder="024 123 4567" autoComplete="tel" />
            </label>
            <label>
              Email (optional, for your receipt)
              <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" />
            </label>
          </div>
        </section>

        <section className="section">
          <h2>2. Delivery</h2>
          <div className="choice">
            <label>
              <input type="radio" checked={method === 'HOME'} onChange={() => setMethod('HOME')} /> Deliver to my door
            </label>
            {options.pickupStations.length > 0 && (
              <label>
                <input type="radio" checked={method === 'PICKUP'} onChange={() => setMethod('PICKUP')} /> Pick up from a station (cheaper)
              </label>
            )}
          </div>

          {method === 'HOME' ? (
            <div className="fields">
              <label>
                Delivery area
                <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                  {options.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}: {formatGhs(z.fee)}, {z.minDays}–{z.maxDays} days
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Region
                <select value={form.region} onChange={(e) => set({ region: e.target.value })}>
                  {REGIONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label>
                Town or city
                <input value={form.city} onChange={(e) => set({ city: e.target.value })} required minLength={2} placeholder="Accra" />
              </label>
              <label>
                Area
                <input value={form.area} onChange={(e) => set({ area: e.target.value })} required minLength={2} placeholder="East Legon" />
              </label>
              <label>
                Street or house (optional)
                <input value={form.street} onChange={(e) => set({ street: e.target.value })} />
              </label>
              <label>
                Landmark (optional)
                <input value={form.landmark} onChange={(e) => set({ landmark: e.target.value })} placeholder="Near the Shell station" />
              </label>
              <label>
                GhanaPost GPS (optional)
                <input value={form.gpsAddress} onChange={(e) => set({ gpsAddress: e.target.value.toUpperCase() })} placeholder="GA-123-4567" />
              </label>
            </div>
          ) : (
            <div className="fields">
              <label>
                Pickup station
                <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
                  {options.pickupStations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}: {formatGhs(s.fee)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">{options.pickupStations.find((s) => s.id === stationId)?.address}</p>
            </div>
          )}
        </section>

        <section className="section">
          <h2>3. Payment</h2>
          <div className="choice">
            <label className={options.onlinePayments ? '' : 'muted'}>
              <input type="radio" checked={payment === 'MOMO'} disabled={!options.onlinePayments} onChange={() => setPayment('MOMO')} /> Mobile Money (MTN, Telecel, AirtelTigo)
            </label>
            <label className={options.onlinePayments ? '' : 'muted'}>
              <input type="radio" checked={payment === 'CARD'} disabled={!options.onlinePayments} onChange={() => setPayment('CARD')} /> Visa or Mastercard
            </label>
            <label className={podTooBig ? 'muted' : ''}>
              <input type="radio" checked={payment === 'PAY_ON_DELIVERY'} disabled={podTooBig} onChange={() => setPayment('PAY_ON_DELIVERY')} /> Pay on delivery (cash or MoMo to the rider)
            </label>
          </div>
          {!options.onlinePayments && <p className="muted">MoMo and card payments are being switched on. You can pay on delivery today.</p>}
          {podTooBig && <p className="muted">Pay on delivery is available for orders up to {formatGhs(options.payOnDeliveryMax)}.</p>}
          <label style={{ display: 'block', marginTop: 12 }}>
            Note for the rider (optional)
            <input value={form.note} onChange={(e) => set({ note: e.target.value })} style={{ width: '100%' }} />
          </label>
        </section>
      </div>

      <aside className="section summary">
        <h2>Order summary</h2>
        <div className="summary-item">
          {item.image ? <img src={item.image} alt="" width={64} height={64} /> : <div style={{ width: 64 }} />}
          <div>
            <div>{item.name}</div>
            <div className="muted">{item.variantName}</div>
            <label className="muted">
              Qty{' '}
              <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
                {Array.from({ length: Math.min(10, item.stock) }, (_, i) => i + 1).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <dl>
          <dt>Subtotal</dt>
          <dd>{formatGhs(totals.subtotal)}</dd>
          <dt>Delivery</dt>
          <dd>{totals.deliveryFee === 0 ? 'Free' : formatGhs(totals.deliveryFee)}</dd>
          <dt className="total">Total</dt>
          <dd className="total">{formatGhs(totals.total)}</dd>
        </dl>
        {totals.days && (
          <p className="muted">
            Arrives in {totals.days.minDays}–{totals.days.maxDays} days
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Please wait…' : payment === 'PAY_ON_DELIVERY' ? 'Place order' : `Pay ${formatGhs(totals.total)}`}
        </button>
      </aside>
    </form>
  );
}
