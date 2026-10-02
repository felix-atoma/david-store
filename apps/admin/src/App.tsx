import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import Categories from './pages/Categories';
import ProductEditor from './pages/ProductEditor';
import Products from './pages/Products';
import Settings from './pages/Settings';
import { SessionProvider, useSession } from './session';

/** Dashboard sections from the project specification. Each is built in its phase. */
const SECTIONS = [
  { path: '/', label: 'Overview' },
  { path: '/products', label: 'Products' },
  { path: '/categories', label: 'Categories' },
  { path: '/inventory', label: 'Inventory' },
  { path: '/orders', label: 'Orders' },
  { path: '/customers', label: 'Customers' },
  { path: '/marketing', label: 'Marketing' },
  { path: '/reviews', label: 'Reviews' },
  { path: '/content', label: 'Content' },
  { path: '/delivery', label: 'Delivery' },
  { path: '/reports', label: 'Reports' },
  { path: '/settings', label: 'Settings' },
  { path: '/activity', label: 'Activity log' },
];

const BUILT = ['/products', '/categories', '/settings'];

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const { user, ready, logout } = useSession();
  if (!ready) return <p className="center muted">Loading…</p>;
  if (!user) return <Login />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.svg" alt="Davo" height={26} />
          <span>Admin</span>
        </div>
        <nav>
          {SECTIONS.map((s) => (
            <NavLink key={s.path} to={s.path} end={s.path === '/'}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <div>{user.name}</div>
          <button type="button" className="link" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductEditor />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/settings" element={<Settings />} />
          {SECTIONS.filter((s) => !BUILT.includes(s.path)).map((s) => (
            <Route key={s.path} path={s.path} element={<ComingSoon title={s.label} />} />
          ))}
        </Routes>
      </main>
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="muted">This section is built in the core store phase.</p>
    </>
  );
}

function Login() {
  const { login } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(identifier, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <h1>Sign in</h1>
      <label>
        Email or phone
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
