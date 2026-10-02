import { slugify } from '@david-store/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type FieldType = 'NUMBER' | 'TEXT' | 'SELECT' | 'MULTI_SELECT' | 'BOOLEAN';

interface SpecField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  unit: string | null;
  options: string[];
  filterable: boolean;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  tagline: string | null;
  description: string | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  specFields: SpecField[];
  _count: { products: number; children: number };
}

const TYPE_LABELS: Record<FieldType, string> = {
  NUMBER: 'Number (range filter)',
  SELECT: 'One choice',
  MULTI_SELECT: 'Several choices',
  BOOLEAN: 'Yes / no',
  TEXT: 'Free text (not filterable)',
};

/** Depth-first order with indentation, so the flat list reads as a tree. */
const flatten = (all: Category[]) => {
  const out: { category: Category; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) =>
    all
      .filter((c) => c.parentId === parentId)
      .forEach((c) => {
        out.push({ category: c, depth });
        walk(c.id, depth + 1);
      });
  walk(null, 0);
  return out;
};

export default function Categories() {
  const [all, setAll] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api<Category[]>('/admin/categories').then(setAll).catch((e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => flatten(all), [all]);
  const selected = all.find((c) => c.id === selectedId) ?? null;

  /** Fields this category gets from the categories above it. */
  const inherited = useMemo(() => {
    const result: (SpecField & { from: string })[] = [];
    let parent = all.find((c) => c.id === selected?.parentId);
    while (parent) {
      result.unshift(...parent.specFields.map((f) => ({ ...f, from: parent!.name })));
      const next = parent.parentId;
      parent = all.find((c) => c.id === next);
    }
    return result;
  }, [all, selected]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <h1>Categories</h1>
      <p className="muted">Add any category David sells. Sub-categories inherit their parent's filters. Hide a category to take it off the shop without losing its products.</p>
      {error && <p className="error">{error}</p>}

      <div className="split">
        <div className="panel">
          <NewCategory all={rows} onCreate={(body) => run(() => api('/admin/categories', { method: 'POST', body: JSON.stringify(body) }))} />
          <ul className="tree">
            {rows.map(({ category: c, depth }) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={c.id === selectedId ? 'tree-item active' : 'tree-item'}
                  style={{ paddingLeft: 8 + depth * 18 }}
                  onClick={() => setSelectedId(c.id)}
                >
                  <span className={c.isActive ? '' : 'muted'}>
                    {c.name}
                    {!c.isActive && ' (hidden)'}
                    {c.isFeatured && ' ★'}
                  </span>
                  <span className="muted">{c._count.products}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selected ? (
          <div className="panel">
            <EditCategory
              key={selected.id}
              category={selected}
              all={rows}
              onSave={(body) => run(() => api(`/admin/categories/${selected.id}`, { method: 'PATCH', body: JSON.stringify(body) }))}
            />

            <h2>Filters and product fields</h2>
            {inherited.length > 0 && (
              <p className="muted">
                Inherited: {inherited.map((f) => `${f.label} (from ${f.from})`).join(', ')}
              </p>
            )}
            <table className="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Type</th>
                  <th>Options / unit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {selected.specFields.map((f) => (
                  <tr key={f.id}>
                    <td>{f.label}</td>
                    <td>
                      <code>{f.key}</code>
                    </td>
                    <td>{TYPE_LABELS[f.type]}</td>
                    <td>{f.options.length ? f.options.join(', ') : f.unit}</td>
                    <td>
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          confirm(`Remove "${f.label}"? Products keep their stored values, but the filter disappears.`) &&
                          run(() => api(`/admin/categories/spec-fields/${f.id}`, { method: 'DELETE' }))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {selected.specFields.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No fields of its own.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <NewField onCreate={(body) => run(() => api(`/admin/categories/${selected.id}/spec-fields`, { method: 'POST', body: JSON.stringify(body) }))} />
          </div>
        ) : (
          <div className="panel muted">Pick a category to edit it and its filters.</div>
        )}
      </div>
    </>
  );
}

function ParentSelect({ all, value, onChange, exclude }: { all: { category: Category; depth: number }[]; value: string; onChange: (v: string) => void; exclude?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Top level</option>
      {all
        .filter(({ category }) => category.id !== exclude)
        .map(({ category, depth }) => (
          <option key={category.id} value={category.id}>
            {'— '.repeat(depth)}
            {category.name}
          </option>
        ))}
    </select>
  );
}

function NewCategory({ all, onCreate }: { all: { category: Category; depth: number }[]; onCreate: (body: object) => Promise<void> }) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        await onCreate({ name, parentId: parentId || null });
        setName('');
      }}
    >
      <input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      <ParentSelect all={all} value={parentId} onChange={setParentId} />
      <button className="btn">Add</button>
    </form>
  );
}

function EditCategory({ category, all, onSave }: { category: Category; all: { category: Category; depth: number }[]; onSave: (body: object) => Promise<void> }) {
  const [form, setForm] = useState({
    name: category.name,
    parentId: category.parentId ?? '',
    tagline: category.tagline ?? '',
    description: category.description ?? '',
    sortOrder: category.sortOrder,
    isFeatured: category.isFeatured,
    isActive: category.isActive,
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ ...form, parentId: form.parentId || null, tagline: form.tagline || null, description: form.description || null });
      }}
    >
      <h2 style={{ marginTop: 0 }}>{category.name}</h2>
      <p className="muted">
        Shop link: /c/{category.slug} · {category._count.products} products · {category._count.children} sub-categories
      </p>
      <label>
        Name
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} required />
      </label>
      <label>
        Inside
        <ParentSelect all={all} value={form.parentId} onChange={(v) => set({ parentId: v })} exclude={category.id} />
      </label>
      <label>
        Tagline
        <input value={form.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="Immersive Sound, Anywhere." />
      </label>
      <label>
        Description
        <textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <label>
        Order in menus
        <input type="number" value={form.sortOrder} onChange={(e) => set({ sortOrder: Number(e.target.value) })} />
      </label>
      <label className="check">
        <input type="checkbox" checked={form.isFeatured} onChange={(e) => set({ isFeatured: e.target.checked })} /> Show on the homepage
      </label>
      <label className="check">
        <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Visible in the shop
      </label>
      <button className="btn">Save category</button>
    </form>
  );
}

function NewField({ onCreate }: { onCreate: (body: object) => Promise<void> }) {
  const empty = { label: '', key: '', type: 'SELECT' as FieldType, unit: '', options: '' };
  const [form, setForm] = useState(empty);
  const [keyTouched, setKeyTouched] = useState(false);
  const needsOptions = form.type === 'SELECT' || form.type === 'MULTI_SELECT';

  // "Battery life" → "batteryLife" until the key is edited by hand.
  const camel = (label: string) => slugify(label).replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

  return (
    <form
      className="stack"
      style={{ marginTop: 16 }}
      onSubmit={async (e) => {
        e.preventDefault();
        await onCreate({
          label: form.label,
          key: form.key,
          type: form.type,
          unit: form.type === 'NUMBER' && form.unit ? form.unit : undefined,
          options: needsOptions ? form.options.split(',').map((o) => o.trim()).filter(Boolean) : undefined,
          filterable: form.type !== 'TEXT',
        });
        setForm(empty);
        setKeyTouched(false);
      }}
    >
      <strong>Add a field</strong>
      <div className="inline-form">
        <input placeholder="Label, e.g. Screen size" value={form.label} required onChange={(e) => setForm({ ...form, label: e.target.value, key: keyTouched ? form.key : camel(e.target.value) })} />
        <input placeholder="key" value={form.key} required pattern="[a-zA-Z][a-zA-Z0-9]*" onChange={(e) => (setKeyTouched(true), setForm({ ...form, key: e.target.value }))} />
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FieldType })}>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {needsOptions && <input placeholder="Options, comma-separated: Small, Medium, Large" value={form.options} required onChange={(e) => setForm({ ...form, options: e.target.value })} />}
      {form.type === 'NUMBER' && <input placeholder="Unit, e.g. inches, kg, hours" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />}
      <button className="btn">Add field</button>
    </form>
  );
}
