import { formatGhs, MAX_PRODUCT_IMAGES, productSeoDescription, productSeoTitle, toCedis, toPesewas } from '@david-store/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, imageSrc, STOREFRONT_URL, uploadImage } from '../api';
import { categoryOptions, STATUS_LABELS } from './Products';

type FieldType = 'NUMBER' | 'TEXT' | 'SELECT' | 'MULTI_SELECT' | 'BOOLEAN';

interface SpecField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  unit: string | null;
  options: string[];
  required: boolean;
}

interface Category {
  id: string;
  name: string;
  parentId: string | null;
  specFields: SpecField[];
}

interface Variant {
  id?: string;
  name: string;
  sku: string;
  /** Kept as typed text (cedis) until saving. */
  price: string;
  oldPrice: string;
  stock: string;
}

interface Photo {
  url: string;
  alt: string;
}

interface Loaded {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  brand: string;
  description: string;
  keyFeatures: string[];
  inTheBox: string[];
  specs: Record<string, unknown>;
  images: { url: string; alt: string | null }[];
  variants: { id: string; name: string; sku: string; price: number; oldPrice: number | null; stock: number }[];
  status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';
  publishAt: string | null;
  freeDelivery: boolean;
  isFeatured: boolean;
  videoUrl: string | null;
  warranty: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

type Status = 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'HIDDEN';

const SINGLE = 'Standard';
const cedis = (pesewas: number | null | undefined) => (pesewas ? String(toCedis(pesewas)) : '');
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

/** "2026-10-04T09:00" in the computer's local time, for <input type="datetime-local">. */
const localInput = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 86_400_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function ProductEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();

  const [categories, setCategories] = useState<Category[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState({
    name: '',
    categoryId: '',
    brand: '',
    description: '',
    keyFeatures: '',
    inTheBox: '',
    freeDelivery: false,
    isFeatured: false,
    videoUrl: '',
    warranty: '',
    seoTitle: '',
    seoDescription: '',
  });
  const [specs, setSpecs] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [variants, setVariants] = useState<Variant[]>([{ name: SINGLE, sku: '', price: '', oldPrice: '', stock: '' }]);
  const [hasOptions, setHasOptions] = useState(false);
  const [status, setStatus] = useState<Status>('PUBLISHED');
  const [publishAt, setPublishAt] = useState(localInput(null));
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [brands, setBrands] = useState<string[]>([]);

  useEffect(() => {
    api<Category[]>('/admin/categories').then(setCategories).catch((e: Error) => setError(e.message));
    api<{ items: { brand: { name: string } | null }[] }>('/admin/products?status=ALL')
      .then((r) => setBrands([...new Set(r.items.map((i) => i.brand?.name).filter(Boolean) as string[])].sort()))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isNew) return;
    api<Loaded>(`/admin/products/${id}`)
      .then((p) => {
        setLoaded(p);
        setForm({
          name: p.name,
          categoryId: p.categoryId,
          brand: p.brand,
          description: p.description,
          keyFeatures: p.keyFeatures.join('\n'),
          inTheBox: p.inTheBox.join('\n'),
          freeDelivery: p.freeDelivery,
          isFeatured: p.isFeatured,
          videoUrl: p.videoUrl ?? '',
          warranty: p.warranty ?? '',
          seoTitle: p.seoTitle ?? '',
          seoDescription: p.seoDescription ?? '',
        });
        setSpecs(p.specs ?? {});
        setPhotos(p.images.map((i) => ({ url: i.url, alt: i.alt ?? '' })));
        setVariants(p.variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku, price: cedis(v.price), oldPrice: cedis(v.oldPrice), stock: String(v.stock) })));
        setHasOptions(p.variants.length > 1 || (p.variants[0] && p.variants[0].name !== SINGLE));
        setStatus(p.status === 'ARCHIVED' ? 'HIDDEN' : p.status);
        setPublishAt(localInput(p.publishAt));
      })
      .catch((e: Error) => setError(e.message));
  }, [id, isNew]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  /** The chosen category's fields plus everything inherited from the categories above it. */
  const fields = useMemo(() => {
    const byKey = new Map<string, SpecField>();
    const chain: Category[] = [];
    let c = categories.find((x) => x.id === form.categoryId);
    while (c) {
      chain.unshift(c);
      const parent = c.parentId;
      c = categories.find((x) => x.id === parent);
    }
    for (const cat of chain) for (const f of cat.specFields) byKey.set(f.key, f);
    return [...byKey.values()];
  }, [categories, form.categoryId]);

  const options = useMemo(() => categoryOptions(categories), [categories]);

  // ── Photos ──────────────────────────────────────────────
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = async (files: FileList | File[]) => {
    const room = MAX_PRODUCT_IMAGES - photos.length;
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)).slice(0, room);
    if (!list.length) {
      if (room <= 0) setError(`Up to ${MAX_PRODUCT_IMAGES} photos per product.`);
      return;
    }
    setError('');
    setUploading((n) => n + list.length);
    // One at a time keeps phone uploads on slow networks from timing out.
    for (const file of list) {
      try {
        const up = await uploadImage(file);
        setPhotos((p) => [...p, { url: up.url, alt: '' }]);
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const movePhoto = (from: number, to: number) =>
    setPhotos((p) => {
      if (to < 0 || to >= p.length) return p;
      const next = [...p];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  // ── Variants ────────────────────────────────────────────
  const setVariant = (i: number, patch: Partial<Variant>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const toggleOptions = (on: boolean) => {
    setHasOptions(on);
    if (on && variants.length === 1 && variants[0].name === SINGLE) setVariant(0, { name: '' });
    if (!on) setVariants((vs) => [{ ...vs[0], name: SINGLE }]);
  };

  // ── Save ────────────────────────────────────────────────
  const priceOf = (v: Variant) => Number(v.price);
  const cheapest = variants.reduce<number | null>((min, v) => (v.price && (min === null || priceOf(v) < min) ? priceOf(v) : min), null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved('');
    if (uploading) return setError('Wait for the photos to finish uploading.');
    for (const v of variants) {
      if (!v.name.trim()) return setError('Give every option a name, for example a colour or model.');
      if (!(Number(v.price) >= 1)) return setError(`Enter a price for "${v.name || 'the product'}".`);
      if (v.oldPrice && Number(v.oldPrice) <= Number(v.price)) return setError(`The old price for "${v.name}" must be higher than the price, or empty.`);
    }

    const body = {
      name: form.name.trim(),
      categoryId: form.categoryId,
      brand: form.brand.trim() || undefined,
      description: form.description.trim(),
      keyFeatures: lines(form.keyFeatures),
      inTheBox: lines(form.inTheBox),
      specs,
      images: photos.map((p) => ({ url: p.url, alt: p.alt.trim() || undefined })),
      variants: variants.map((v) => ({
        id: v.id,
        name: hasOptions ? v.name.trim() : SINGLE,
        sku: v.sku.trim() || undefined,
        price: toPesewas(Number(v.price)),
        oldPrice: v.oldPrice ? toPesewas(Number(v.oldPrice)) : null,
        stock: Math.max(0, Math.round(Number(v.stock) || 0)),
      })),
      status,
      publishAt: status === 'SCHEDULED' ? new Date(publishAt).toISOString() : undefined,
      freeDelivery: form.freeDelivery,
      isFeatured: form.isFeatured,
      videoUrl: form.videoUrl.trim() || null,
      warranty: form.warranty.trim() || null,
      seoTitle: form.seoTitle.trim() || null,
      seoDescription: form.seoDescription.trim() || null,
    };

    setSaving(true);
    try {
      const result = await api<Loaded>(isNew ? '/admin/products' : `/admin/products/${id}`, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(body) });
      setLoaded(result);
      setVariants(result.variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku, price: cedis(v.price), oldPrice: cedis(v.oldPrice), stock: String(v.stock) })));
      setSaved(status === 'PUBLISHED' ? 'Saved and live in the shop.' : status === 'DRAFT' ? 'Saved as a draft. Customers can’t see it yet.' : 'Saved.');
      if (isNew) navigate(`/products/${result.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && !loaded && !error) return <p className="muted">Loading…</p>;

  const seoPreview = {
    title: productSeoTitle({ name: form.name || 'Product name', seoTitle: form.seoTitle }),
    description: productSeoDescription({ name: form.name || 'Product name', price: cheapest ? toPesewas(cheapest) : 0, description: form.description || '…', seoDescription: form.seoDescription }),
  };

  return (
    <form className="editor" onSubmit={save}>
      <div className="page-head">
        <div>
          <Link to="/products" className="muted small">
            ← Products
          </Link>
          <h1>{isNew ? 'Add product' : form.name || 'Edit product'}</h1>
        </div>
        {loaded?.status === 'PUBLISHED' && (
          <a className="btn secondary" href={`${STOREFRONT_URL}/p/${loaded.slug}`} target="_blank" rel="noreferrer">
            View in shop
          </a>
        )}
      </div>

      <section className="panel stack">
        <h2>1. The basics</h2>
        <label>
          Product name
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} required minLength={3} maxLength={150} placeholder="e.g. JBL Flip 6 Waterproof Bluetooth Speaker" />
          <span className="muted small">Brand, model and the main feature, the way a shopper would search for it.</span>
        </label>
        <div className="two-col">
          <label>
            Category
            <select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })} required>
              <option value="">Choose a category…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Brand
            <input value={form.brand} onChange={(e) => set({ brand: e.target.value })} list="brand-list" placeholder="e.g. JBL (leave empty if none)" maxLength={60} />
            <datalist id="brand-list">
              {brands.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
        </div>
        <label>
          Description
          <textarea rows={5} value={form.description} onChange={(e) => set({ description: e.target.value })} required minLength={10} maxLength={6000} placeholder="What it is, who it is for, and why it is good." />
        </label>
        <div className="two-col">
          <label>
            Key features <span className="muted small">(one per line)</span>
            <textarea rows={4} value={form.keyFeatures} onChange={(e) => set({ keyFeatures: e.target.value })} placeholder={'20W sound\n12-hour battery\nWaterproof IPX7'} />
          </label>
          <label>
            What’s in the box <span className="muted small">(one per line)</span>
            <textarea rows={4} value={form.inTheBox} onChange={(e) => set({ inTheBox: e.target.value })} placeholder={'Speaker\nUSB-C cable\nUser guide'} />
          </label>
        </div>
      </section>

      <section className="panel stack">
        <h2>2. Photos</h2>
        <p className="muted small">
          Up to {MAX_PRODUCT_IMAGES} photos. The first is the main photo. Large phone photos are fine; they are shrunk and compressed automatically.
        </p>
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void addFiles(e.dataTransfer.files);
          }}
        >
          <div className="photos">
            {photos.map((p, i) => (
              <figure key={p.url} className="photo">
                <img src={imageSrc(p.url)} alt={p.alt || `Photo ${i + 1}`} />
                {i === 0 && <span className="main-badge">Main</span>}
                <figcaption>
                  <button type="button" className="icon-btn" aria-label="Move left" disabled={i === 0} onClick={() => movePhoto(i, i - 1)}>
                    ‹
                  </button>
                  <button type="button" className="icon-btn" aria-label="Move right" disabled={i === photos.length - 1} onClick={() => movePhoto(i, i + 1)}>
                    ›
                  </button>
                  <button type="button" className="icon-btn danger" aria-label="Remove photo" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </figcaption>
              </figure>
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <div key={`up-${i}`} className="photo uploading">
                Uploading…
              </div>
            ))}
            {photos.length + uploading < MAX_PRODUCT_IMAGES && (
              <button type="button" className="photo add-photo" onClick={() => fileInput.current?.click()}>
                <span>+</span>
                Add photos
                <small>or drag them here</small>
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <label>
          Product video link <span className="muted small">(optional, e.g. YouTube)</span>
          <input type="url" value={form.videoUrl} onChange={(e) => set({ videoUrl: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" />
        </label>
      </section>

      <section className="panel stack">
        <h2>3. Price and stock</h2>
        <label className="check">
          <input type="checkbox" checked={hasOptions} onChange={(e) => toggleOptions(e.target.checked)} /> This product comes in options (colours, sizes or models), each with its own price or stock
        </label>
        <div className="table-wrap">
          <table className="table variants-table">
            <thead>
              <tr>
                {hasOptions && <th>Option name</th>}
                <th>Price (GH₵)</th>
                <th>Old price (GH₵)</th>
                <th>In stock</th>
                <th>SKU</th>
                {hasOptions && <th />}
              </tr>
            </thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={v.id ?? `new-${i}`}>
                  {hasOptions && (
                    <td>
                      <input value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder="e.g. Black" aria-label="Option name" required maxLength={60} />
                    </td>
                  )}
                  <td>
                    <input type="number" min={1} step={0.01} value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} required aria-label="Price" placeholder="0.00" />
                  </td>
                  <td>
                    <input type="number" min={0} step={0.01} value={v.oldPrice} onChange={(e) => setVariant(i, { oldPrice: e.target.value })} aria-label="Old price" placeholder="optional" />
                  </td>
                  <td>
                    <input type="number" min={0} step={1} value={v.stock} onChange={(e) => setVariant(i, { stock: e.target.value })} required aria-label="Stock" placeholder="0" />
                  </td>
                  <td>
                    <input value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value.toUpperCase() })} aria-label="SKU" placeholder="auto" maxLength={64} />
                  </td>
                  {hasOptions && (
                    <td>
                      <button type="button" className="icon-btn danger" aria-label="Remove option" disabled={variants.length === 1} onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasOptions && (
          <button type="button" className="btn secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setVariants((vs) => [...vs, { name: '', sku: '', price: vs[vs.length - 1]?.price ?? '', oldPrice: '', stock: '' }])}>
            + Add another option
          </button>
        )}
        <p className="muted small">The old price shows crossed out with a “-%” badge. Leave it empty when there is no discount. The SKU is made up for you if left empty.</p>
      </section>

      {form.categoryId && fields.length > 0 && (
        <section className="panel stack">
          <h2>4. Details for {categories.find((c) => c.id === form.categoryId)?.name}</h2>
          <p className="muted small">These power the shop’s filters, so shoppers can find this product.</p>
          <div className="two-col">
            {fields.map((f) => (
              <SpecInput key={f.key} field={f} value={specs[f.key]} onChange={(v) => setSpecs((s) => ({ ...s, [f.key]: v }))} />
            ))}
          </div>
        </section>
      )}

      <section className="panel stack">
        <h2>{form.categoryId && fields.length > 0 ? '5' : '4'}. Extras</h2>
        <div className="two-col">
          <label>
            Warranty <span className="muted small">(optional)</span>
            <input value={form.warranty} onChange={(e) => set({ warranty: e.target.value })} placeholder="e.g. 1 year manufacturer warranty" maxLength={120} />
          </label>
          <div className="stack" style={{ gap: 8 }}>
            <label className="check">
              <input type="checkbox" checked={form.freeDelivery} onChange={(e) => set({ freeDelivery: e.target.checked })} /> Free delivery
            </label>
            <label className="check">
              <input type="checkbox" checked={form.isFeatured} onChange={(e) => set({ isFeatured: e.target.checked })} /> Feature on the homepage
            </label>
          </div>
        </div>
        <details>
          <summary>Google search text (optional)</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <label>
              Search title <span className="muted small">({form.seoTitle.length}/70, leave empty for automatic)</span>
              <input value={form.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} maxLength={70} />
            </label>
            <label>
              Search description <span className="muted small">({form.seoDescription.length}/170, leave empty for automatic)</span>
              <textarea rows={2} value={form.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} maxLength={170} />
            </label>
            <div className="serp" aria-label="How it may look on Google">
              <div className="serp-url">david-store-web.vercel.app › p › {loaded?.slug ?? '…'}</div>
              <div className="serp-title">{seoPreview.title}</div>
              <div className="serp-desc">{seoPreview.description}</div>
            </div>
          </div>
        </details>
      </section>

      <div className="save-bar">
        <div className="save-status">
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="When customers can see it">
            <option value="PUBLISHED">Publish now</option>
            <option value="DRAFT">Save as draft</option>
            <option value="SCHEDULED">Schedule</option>
            <option value="HIDDEN">Hidden</option>
          </select>
          {status === 'SCHEDULED' && <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} aria-label="Publish on" required />}
          {cheapest !== null && <span className="muted small">From {formatGhs(toPesewas(cheapest))}</span>}
          {loaded && <span className="muted small">Now: {STATUS_LABELS[loaded.status]}</span>}
        </div>
        <div className="save-actions">
          {saved && <span className="ok small">{saved}</span>}
          {error && <span className="error small">{error}</span>}
          <button className="btn" disabled={saving || uploading > 0}>
            {saving ? 'Saving…' : uploading ? 'Uploading photos…' : 'Save product'}
          </button>
        </div>
      </div>
    </form>
  );
}

function SpecInput({ field, value, onChange }: { field: SpecField; value: unknown; onChange: (v: unknown) => void }) {
  const label = (
    <>
      {field.label}
      {field.unit ? ` (${field.unit})` : ''}
      {field.required && <span className="error"> *</span>}
    </>
  );
  if (field.type === 'BOOLEAN') {
    return (
      <label className="check">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
    );
  }
  if (field.type === 'SELECT') {
    return (
      <label>
        {label}
        <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === 'MULTI_SELECT') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="multi">
        <legend>{label}</legend>
        {field.options.map((o) => (
          <label key={o} className="check">
            <input type="checkbox" checked={selected.includes(o)} onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))} /> {o}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <label>
      {label}
      <input
        type={field.type === 'NUMBER' ? 'number' : 'text'}
        step="any"
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? undefined : field.type === 'NUMBER' ? Number(e.target.value) : e.target.value)}
        maxLength={200}
      />
    </label>
  );
}
