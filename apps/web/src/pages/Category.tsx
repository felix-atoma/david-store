import { PRODUCT_SORTS, toCedis, toPesewas } from '@david-store/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type CategoryPage as Category, type ProductList, type SpecField } from '../api';
import Breadcrumb from '../components/Breadcrumb';
import { ProductGrid } from '../components/ProductCard';

const SORT_LABELS: Record<(typeof PRODUCT_SORTS)[number], string> = {
  popularity: 'Popularity',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
  newest: 'Newest',
  rating: 'Rating',
};

/** Spec filters live in the URL as `spec=batteryHours:10-20|ipRating:IPX7,IP67`, so links can be shared. */
const parseSpec = (raw: string | null) =>
  new Map(
    (raw ?? '')
      .split('|')
      .filter(Boolean)
      .map((part) => [part.slice(0, part.indexOf(':')), part.slice(part.indexOf(':') + 1)] as [string, string]),
  );
const formatSpec = (spec: Map<string, string>) =>
  [...spec].filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join('|');

export default function CategoryPage() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState<Category | null>(null);
  const [list, setList] = useState<ProductList | null>(null);
  const [error, setError] = useState('');

  const spec = useMemo(() => parseSpec(params.get('spec')), [params]);

  useEffect(() => {
    setCategory(null);
    api<Category>(`/categories/${slug}`).then(setCategory).catch((e: Error) => setError(e.message));
  }, [slug]);

  useEffect(() => {
    const query = new URLSearchParams(params);
    query.set('category', slug);
    api<ProductList>(`/products?${query}`).then(setList).catch((e: Error) => setError(e.message));
  }, [slug, params]);

  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next, { replace: true });
  };

  const setSpec = (key: string, value: string) => {
    const next = new Map(spec);
    next.set(key, value);
    update('spec', formatSpec(next) || null);
  };

  const toggleList = (current: string | undefined | null, value: string) => {
    const set = new Set((current ?? '').split(',').filter(Boolean));
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return [...set].join(',');
  };

  if (error) return <p className="section">{error}</p>;
  if (!category) return <p className="section">Loading…</p>;

  return (
    <>
      <Breadcrumb trail={category.breadcrumb.slice(0, -1)} current={category.name} />
      <section className="hero" style={category.bannerUrl ? { backgroundImage: `url(${category.bannerUrl})`, backgroundSize: 'cover' } : undefined}>
        <h1>{category.tagline ?? category.name}</h1>
        {category.tagline && <p style={{ fontWeight: 600, marginBottom: 8 }}>{category.name}</p>}
        {category.description && <p>{category.description}</p>}
      </section>
      {category.children.length > 0 && (
        <div className="chips">
          {category.children.map((c) => (
            <Link key={c.slug} to={`/c/${c.slug}`} className="chip">
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <div className="layout" style={{ marginTop: 16 }}>
        <aside className="filters" aria-label="Filters">
          {category.brands.length > 0 && (
            <fieldset>
              <legend>Brand</legend>
              {category.brands.map((b) => (
                <label key={b.slug}>
                  <input
                    type="checkbox"
                    checked={(params.get('brand') ?? '').split(',').includes(b.slug)}
                    onChange={() => update('brand', toggleList(params.get('brand'), b.slug) || null)}
                  />
                  {b.name}
                </label>
              ))}
            </fieldset>
          )}

          <fieldset>
            <legend>Price (GH₵)</legend>
            <RangeInputs
              min={params.get('minPrice') ? String(toCedis(Number(params.get('minPrice')))) : ''}
              max={params.get('maxPrice') ? String(toCedis(Number(params.get('maxPrice')))) : ''}
              onChange={(min, max) => {
                const next = new URLSearchParams(params);
                min ? next.set('minPrice', String(toPesewas(Number(min)))) : next.delete('minPrice');
                max ? next.set('maxPrice', String(toPesewas(Number(max)))) : next.delete('maxPrice');
                setParams(next, { replace: true });
              }}
            />
          </fieldset>

          {category.specFields.map((field) => (
            <SpecFilter key={field.key} field={field} value={spec.get(field.key) ?? ''} onChange={(v) => setSpec(field.key, v)} toggle={toggleList} />
          ))}
        </aside>

        <section>
          <div className="toolbar">
            <span className="muted">{list ? `${list.total} products` : ''}</span>
            <label>
              Sort by{' '}
              <select value={params.get('sort') ?? 'popularity'} onChange={(e) => update('sort', e.target.value)}>
                {PRODUCT_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {list && <ProductGrid products={list.items} />}
          {list?.items.length === 0 && <p className="section muted">No products match these filters.</p>}
        </section>
      </div>
    </>
  );
}

function SpecFilter({
  field,
  value,
  onChange,
  toggle,
}: {
  field: SpecField;
  value: string;
  onChange: (value: string) => void;
  toggle: (current: string, value: string) => string;
}) {
  const label = field.unit ? `${field.label} (${field.unit})` : field.label;
  if (field.type === 'NUMBER') {
    const [min = '', max = ''] = value.split('-');
    return (
      <fieldset>
        <legend>{label}</legend>
        <RangeInputs min={min} max={max} onChange={(a, b) => onChange(a || b ? `${a}-${b}` : '')} />
      </fieldset>
    );
  }
  if (field.type === 'BOOLEAN') {
    return (
      <fieldset>
        <legend>{label}</legend>
        <label>
          <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : '')} />
          Yes
        </label>
      </fieldset>
    );
  }
  if (!field.options.length) return null;
  return (
    <fieldset>
      <legend>{label}</legend>
      {field.options.map((option) => (
        <label key={option}>
          <input type="checkbox" checked={value.split(',').includes(option)} onChange={() => onChange(toggle(value, option))} />
          {option}
        </label>
      ))}
    </fieldset>
  );
}

/** Applies on blur or Enter, so typing doesn't fire a request per keystroke. */
function RangeInputs({ min, max, onChange }: { min: string; max: string; onChange: (min: string, max: string) => void }) {
  const [a, setA] = useState(min);
  const [b, setB] = useState(max);
  useEffect(() => {
    setA(min);
    setB(max);
  }, [min, max]);
  const apply = () => (a !== min || b !== max) && onChange(a, b);
  const onKey = (e: React.KeyboardEvent) => e.key === 'Enter' && apply();
  return (
    <div className="range">
      <input inputMode="numeric" placeholder="Min" value={a} onChange={(e) => setA(e.target.value.replace(/[^\d.]/g, ''))} onBlur={apply} onKeyDown={onKey} />
      <input inputMode="numeric" placeholder="Max" value={b} onChange={(e) => setB(e.target.value.replace(/[^\d.]/g, ''))} onBlur={apply} onKeyDown={onKey} />
    </div>
  );
}
