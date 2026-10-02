import { formatGhs, toPesewas } from '@david-store/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, imageSrc, STOREFRONT_URL } from '../api';

type Status = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'HIDDEN' | 'ARCHIVED';

interface Row {
  id: string;
  name: string;
  slug: string;
  status: Status;
  publishAt: string | null;
  price: number;
  oldPrice: number | null;
  image: string | null;
  category: { id: string; name: string };
  brand: { name: string } | null;
  variants: { id: string; name: string; price: number; stock: number }[];
  totalStock: number;
  lowStock: boolean;
}

interface ListResponse {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
}

interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
}

export const STATUS_LABELS: Record<Status, string> = {
  PUBLISHED: 'Live',
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  HIDDEN: 'Hidden',
  ARCHIVED: 'Archived',
};

/** Depth-first category list with "—" indents, for filters and pickers. */
export const categoryOptions = (all: CategoryRow[]) => {
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, depth: number) =>
    all
      .filter((c) => c.parentId === parentId)
      .forEach((c) => {
        out.push({ id: c.id, label: `${'— '.repeat(depth)}${c.name}` });
        walk(c.id, depth + 1);
      });
  walk(null, 0);
  return out;
};

export default function Products() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<ListResponse | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const status = params.get('status') ?? '';
  const categoryId = params.get('category') ?? '';
  const page = Number(params.get('page') ?? 1);

  const load = useCallback(() => {
    const query = new URLSearchParams();
    if (params.get('q')) query.set('q', params.get('q')!);
    if (status) query.set('status', status);
    if (categoryId) query.set('categoryId', categoryId);
    query.set('page', String(page));
    return api<ListResponse>(`/admin/products?${query}`)
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, [params, status, categoryId, page]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<CategoryRow[]>('/admin/categories').then(setCategories).catch(() => undefined);
  }, []);

  // Search as you type, after a short pause.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') === q) return;
      const next = new URLSearchParams(params);
      q ? next.set('q', q) : next.delete('q');
      next.delete('page');
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [q, params, setParams]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete('page');
    setParams(next, { replace: true });
  };

  const options = useMemo(() => categoryOptions(categories), [categories]);

  /** Price, stock or status right from the list; the row updates in place. */
  const quick = async (row: Row, body: { price?: number; stock?: number; status?: Status }, done: string) => {
    setError('');
    try {
      const updated = await api<Row>(`/admin/products/${row.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setList((l) => (l ? { ...l, items: l.items.map((r) => (r.id === row.id ? updated : r)) } : l));
      setNotice(`${row.name}: ${done}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const duplicate = async (row: Row) => {
    try {
      const copy = await api<{ id: string }>(`/admin/products/${row.id}/duplicate`, { method: 'POST' });
      navigate(`/products/${copy.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <>
      <div className="page-head">
        <h1>Products</h1>
        <Link to="/products/new" className="btn">
          + Add product
        </Link>
      </div>

      <div className="inline-form filters-bar">
        <input type="search" placeholder="Search name, brand or SKU" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        <select value={status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
          <option value="">All except archived</option>
          {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select value={categoryId} onChange={(e) => setFilter('category', e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {notice && <p className="ok">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {list && list.items.length === 0 && (
        <div className="panel">
          <p>No products here yet.</p>
          <Link to="/products/new" className="btn">
            Add the first product
          </Link>
        </div>
      )}

      {list && list.items.length > 0 && (
        <div className="table-wrap">
          <table className="table products-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Price (GH₵)</th>
                <th>Stock</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.items.map((row) => {
                const single = row.variants.length === 1;
                return (
                  <tr key={row.id}>
                    <td>
                      <Link to={`/products/${row.id}`} className="product-cell">
                        {row.image ? <img src={imageSrc(row.image)} alt="" width={48} height={48} /> : <span className="thumb-empty">No photo</span>}
                        <span>
                          <strong>{row.name}</strong>
                          <span className="muted small">
                            {row.category.name}
                            {row.brand ? ` · ${row.brand.name}` : ''}
                            {!single ? ` · ${row.variants.length} options` : ''}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      {single ? (
                        <QuickNumber
                          label={`Price of ${row.name}`}
                          value={row.price / 100}
                          step={0.01}
                          onSave={(v) => quick(row, { price: toPesewas(v) }, `price is now ${formatGhs(toPesewas(v))}`)}
                        />
                      ) : (
                        <span title="Several options: open the product to change prices">from {formatGhs(row.price)}</span>
                      )}
                    </td>
                    <td>
                      {single ? (
                        <QuickNumber label={`Stock of ${row.name}`} value={row.totalStock} step={1} warn={row.lowStock} onSave={(v) => quick(row, { stock: Math.round(v) }, `stock is now ${Math.round(v)}`)} />
                      ) : (
                        <span className={row.lowStock ? 'error' : ''}>{row.totalStock}</span>
                      )}
                    </td>
                    <td>
                      <select
                        className={`status status-${row.status.toLowerCase()}`}
                        value={row.status}
                        onChange={(e) => quick(row, { status: e.target.value as Status }, `now ${STATUS_LABELS[e.target.value as Status].toLowerCase()}`)}
                        aria-label={`Status of ${row.name}`}
                      >
                        {(Object.keys(STATUS_LABELS) as Status[])
                          .filter((s) => s !== 'SCHEDULED' || row.status === 'SCHEDULED')
                          .map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td>
                      <div className="row-actions">
                      <Link to={`/products/${row.id}`}>Edit</Link>
                      <button type="button" className="link" onClick={() => duplicate(row)}>
                        Duplicate
                      </button>
                      {row.status === 'PUBLISHED' && (
                        <a href={`${STOREFRONT_URL}/p/${row.slug}`} target="_blank" rel="noreferrer">
                          View
                        </a>
                      )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {list && pages > 1 && (
        <div className="pager">
          <button type="button" className="btn secondary" disabled={page <= 1} onClick={() => setFilter('page', String(page - 1))}>
            Previous
          </button>
          <span className="muted">
            Page {page} of {pages} · {list.total} products
          </span>
          <button type="button" className="btn secondary" disabled={page >= pages} onClick={() => setFilter('page', String(page + 1))}>
            Next
          </button>
        </div>
      )}
    </>
  );
}

/** Saves on Enter or when the field loses focus, only if the value changed. */
function QuickNumber({ value, step, warn, label, onSave }: { value: number; step: number; warn?: boolean; label: string; onSave: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v) || v < 0) return setText(String(value));
    if (v !== value) onSave(v);
  };
  return (
    <input
      className={`quick ${warn ? 'warn' : ''}`}
      type="number"
      min={0}
      step={step}
      value={text}
      aria-label={label}
      title={warn ? 'Low stock' : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
