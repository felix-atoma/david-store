import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ProductCard } from '../api';
import { ProductGrid } from '../components/ProductCard';

interface HomeData {
  featured: ProductCard[];
  topDeals: ProductCard[];
  newArrivals: ProductCard[];
  bestSellers: ProductCard[];
  featuredCategories: { name: string; slug: string; tagline: string | null }[];
}

type RowKey = 'featured' | 'topDeals' | 'newArrivals' | 'bestSellers';

const ROWS: { key: RowKey; title: string }[] = [
  { key: 'topDeals', title: 'Top deals' },
  { key: 'featured', title: 'Featured' },
  { key: 'newArrivals', title: 'New arrivals' },
  { key: 'bestSellers', title: 'Best sellers' },
];

export default function Home() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<HomeData>('/home').then(setData).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      {/* Placeholder until the admin-managed hero slider is built. */}
      <section className="hero">
        <h1>Everything you need, delivered across Ghana</h1>
        <p>Phones, electronics, fashion, home and more. Pay with MoMo, card or on delivery.</p>
      </section>

      {error && <p className="section">{error}</p>}

      {data && data.featuredCategories.length > 0 && (
        <section className="section">
          <h2>Shop by category</h2>
          <div className="tiles">
            {data.featuredCategories.map((c) => (
              <Link key={c.slug} to={`/c/${c.slug}`} className="tile">
                <strong>{c.name}</strong>
                {c.tagline && <span>{c.tagline}</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {data &&
        ROWS.filter((r) => data[r.key].length > 0).map((r) => (
          <section key={r.key} className="section">
            <h2>{r.title}</h2>
            <ProductGrid products={data[r.key]} />
          </section>
        ))}
    </>
  );
}
