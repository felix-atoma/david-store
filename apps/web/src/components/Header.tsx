import { formatGhs } from '@david-store/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';

interface MenuCategory {
  id: string;
  name: string;
  slug: string;
  children: MenuCategory[];
}

interface Suggestion {
  name: string;
  slug: string;
  price: number;
  image: string | null;
}

export default function Header() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    api<MenuCategory[]>('/categories').then(setCategories).catch(() => setCategories([]));
  }, []);

  // Debounced autocomplete.
  useEffect(() => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      api<Suggestion[]>(`/products/suggest?q=${encodeURIComponent(q)}`).then(setSuggestions).catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSuggestions([]);
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <header className="header">
      <div className="container">
        <div className="header-row">
          <Link to="/" className="logo" aria-label="Davo home">
            <img src="/logo.svg" alt="Davo" height={32} />
          </Link>
          <form className="search" onSubmit={submit} role="search">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products, brands and categories"
              aria-label="Search products"
            />
            {suggestions.length > 0 && (
              <ul className="suggestions">
                {suggestions.map((s) => (
                  <li key={s.slug}>
                    <Link to={`/p/${s.slug}`} onClick={() => setSuggestions([])}>
                      <span>{s.name}</span>
                      <span className="muted">{formatGhs(s.price)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </form>
        </div>
        <nav className="nav" aria-label="Categories">
          {categories.map((c) => (
            <div key={c.id} className="mega">
              <Link to={`/c/${c.slug}`}>{c.name}</Link>
              {c.children.length > 0 && (
                <div className="mega-panel">
                  {c.children.map((child) => (
                    <div key={child.id}>
                      <Link to={`/c/${child.slug}`} className="mega-heading">
                        {child.name}
                      </Link>
                      {child.children.map((leaf) => (
                        <Link key={leaf.id} to={`/c/${leaf.slug}`}>
                          {leaf.name}
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>
    </header>
  );
}
