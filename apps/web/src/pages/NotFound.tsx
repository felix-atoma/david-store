import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="section">
      <h2>Page not found</h2>
      <p className="muted">The page you are looking for has moved or no longer exists.</p>
      <Link to="/" className="btn">
        Back to the shop
      </Link>
    </section>
  );
}
