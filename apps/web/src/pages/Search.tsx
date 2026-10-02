import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type ProductList } from '../api';
import { ProductGrid } from '../components/ProductCard';

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const [list, setList] = useState<ProductList | null>(null);

  useEffect(() => {
    setList(null);
    api<ProductList>(`/products?q=${encodeURIComponent(q)}`).then(setList).catch(() => setList({ items: [], total: 0, page: 1, pageSize: 24 }));
  }, [q]);

  return (
    <section className="section">
      <h2>Results for “{q}”</h2>
      {!list && <p className="muted">Searching…</p>}
      {list?.total === 0 && <p className="muted">Nothing found. Check the spelling or try a shorter word.</p>}
      {list && <ProductGrid products={list.items} />}
    </section>
  );
}
