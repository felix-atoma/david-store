import { discountPercent, formatGhs } from '@david-store/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type ProductCard, type SpecField } from '../api';
import Breadcrumb from '../components/Breadcrumb';
import { ProductGrid } from '../components/ProductCard';

interface Variant {
  id: string;
  name: string;
  price: number;
  oldPrice: number | null;
  stock: number;
}

interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  description: string;
  keyFeatures: string[];
  inTheBox: string[];
  specs: Record<string, unknown>;
  videoUrl: string | null;
  warranty: string | null;
  ratingAvg: number;
  ratingCount: number;
  brand: { name: string } | null;
  category: { name: string; slug: string; specFields: SpecField[] };
  breadcrumb: { name: string; slug: string }[];
  vendor: { businessName: string; isOfficialStore: boolean };
  images: { id: string; url: string; alt: string | null }[];
  variants: Variant[];
  reviews: { id: string; rating: number; title: string | null; body: string | null; author: string; createdAt: string }[];
  questions: { id: string; question: string; answer: string }[];
  similar: ProductCard[];
}

const RECENT_KEY = 'recentlyViewed';

/** Recently viewed stays on the device; signed-in sync can come later. */
const rememberView = (slug: string) => {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    localStorage.setItem(RECENT_KEY, JSON.stringify([slug, ...list.filter((s) => s !== slug)].slice(0, 20)));
  } catch {
    // Storage can be unavailable in private mode; the feature is optional.
  }
};

const specText = (field: SpecField, value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  const text = Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  return field.unit ? `${text} ${field.unit}` : text;
};

export default function ProductPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [variantId, setVariantId] = useState<string>('');
  const [image, setImage] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    setProduct(null);
    setImage(0);
    api<ProductDetail>(`/products/${slug}`)
      .then((p) => {
        setProduct(p);
        setVariantId(p.variants[0]?.id ?? '');
        document.title = `${p.name} | David Store`;
        rememberView(p.slug);
      })
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  if (error) return <p className="section">{error}</p>;
  if (!product) return <p className="section">Loading…</p>;

  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  const off = variant ? discountPercent(variant.price, variant.oldPrice) : null;
  const shareUrl = `${window.location.origin}/p/${product.slug}`;

  return (
    <>
      <Breadcrumb trail={product.breadcrumb} current={product.name} />
      <section className="section product">
        <div>
          {product.images[image] ? (
            <img className="card-img" src={product.images[image].url} alt={product.images[image].alt ?? product.name} />
          ) : (
            <div className="card-img" />
          )}
          <div className="variants">
            {product.images.map((img, i) => (
              <button key={img.id} type="button" aria-pressed={i === image} onClick={() => setImage(i)} style={{ padding: 2 }}>
                <img src={img.url} alt="" width={56} height={56} style={{ objectFit: 'contain' }} />
              </button>
            ))}
          </div>
        </div>

        <div>
          {product.vendor.isOfficialStore && <span className="badge">Official store</span>}
          <h1 style={{ fontSize: 22, margin: '8px 0' }}>{product.name}</h1>
          {product.brand && <p className="muted">Brand: {product.brand.name}</p>}
          {product.ratingCount > 0 && (
            <p className="muted">
              ★ {product.ratingAvg.toFixed(1)} · {product.ratingCount} verified ratings
            </p>
          )}

          {variant && (
            <p style={{ fontSize: 24, margin: '12px 0' }}>
              <span className="price">{formatGhs(variant.price)}</span>
              {off && (
                <>
                  <span className="old-price">{formatGhs(variant.oldPrice!)}</span> <span className="badge deal">-{off}%</span>
                </>
              )}
            </p>
          )}

          {product.variants.length > 1 && (
            <div className="variants" role="group" aria-label="Options">
              {product.variants.map((v) => (
                <button key={v.id} type="button" aria-pressed={v.id === variant?.id} onClick={() => setVariantId(v.id)} disabled={v.stock <= 0}>
                  {v.name}
                </button>
              ))}
            </div>
          )}

          <p className={variant && variant.stock > 0 ? '' : 'muted'}>
            {!variant || variant.stock <= 0 ? 'Out of stock' : variant.stock <= 5 ? `Only ${variant.stock} left` : 'In stock'}
          </p>
          {/* Buy now goes straight to checkout; the cart arrives with customer accounts. */}
          <button
            className="btn"
            type="button"
            disabled={!variant || variant.stock <= 0}
            onClick={() => variant && navigate(`/checkout?variant=${variant.id}&qty=1`)}
          >
            Buy now
          </button>

          <p style={{ marginTop: 16, fontSize: 14 }}>
            Share:{' '}
            <a href={`https://wa.me/?text=${encodeURIComponent(`${product.name} ${shareUrl}`)}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>{' '}
            ·{' '}
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer">
              Facebook
            </a>{' '}
            ·{' '}
            <a href={`https://x.com/intent/post?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(product.name)}`} target="_blank" rel="noreferrer">
              X
            </a>
          </p>
          {product.warranty && <p className="muted">Warranty: {product.warranty}</p>}
        </div>
      </section>

      <section className="section">
        <h2>Description</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{product.description}</p>
        {product.keyFeatures.length > 0 && (
          <>
            <h2>Key features</h2>
            <ul>
              {product.keyFeatures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        )}
        {product.inTheBox.length > 0 && (
          <>
            <h2>What's in the box</h2>
            <ul>
              {product.inTheBox.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="section">
        <h2>Specifications</h2>
        <table className="specs">
          <tbody>
            {product.category.specFields.map((field) => {
              const text = specText(field, product.specs[field.key]);
              return text ? (
                <tr key={field.key}>
                  <th>{field.label}</th>
                  <td>{text}</td>
                </tr>
              ) : null;
            })}
          </tbody>
        </table>
      </section>

      <section className="section">
        <h2>Verified customer reviews</h2>
        {product.reviews.length === 0 && <p className="muted">No reviews yet.</p>}
        {product.reviews.map((r) => (
          <article key={r.id} style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
            <strong>{'★'.repeat(r.rating)}</strong> {r.title}
            <p>{r.body}</p>
            <p className="muted" style={{ fontSize: 13 }}>
              {r.author} · {new Date(r.createdAt).toLocaleDateString('en-GH')}
            </p>
          </article>
        ))}
      </section>

      {product.questions.length > 0 && (
        <section className="section">
          <h2>Questions and answers</h2>
          {product.questions.map((q) => (
            <div key={q.id} style={{ padding: '6px 0' }}>
              <strong>Q: {q.question}</strong>
              <p style={{ margin: '4px 0' }}>A: {q.answer}</p>
            </div>
          ))}
        </section>
      )}

      {product.similar.length > 0 && (
        <section className="section">
          <h2>Similar products</h2>
          <ProductGrid products={product.similar} />
        </section>
      )}
    </>
  );
}
