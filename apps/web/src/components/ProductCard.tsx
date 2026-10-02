import { discountPercent, formatGhs } from '@david-store/shared';
import { Link } from 'react-router-dom';
import type { ProductCard as Card } from '../api';

export default function ProductCard({ product }: { product: Card }) {
  const off = discountPercent(product.price, product.oldPrice);
  return (
    <Link to={`/p/${product.slug}`} className="card">
      {product.image ? (
        <img className="card-img" src={product.image.url} alt={product.image.alt ?? product.name} loading="lazy" />
      ) : (
        <div className="card-img" />
      )}
      <div className="badges">
        {off && <span className="badge deal">-{off}%</span>}
        {product.officialStore && <span className="badge">Official store</span>}
        {product.freeDelivery && <span className="badge muted">Free delivery</span>}
        {product.outOfStock && <span className="badge muted">Out of stock</span>}
      </div>
      <div className="card-name">{product.name}</div>
      <div>
        <span className="price">{formatGhs(product.price)}</span>
        {product.oldPrice && product.oldPrice > product.price && <span className="old-price">{formatGhs(product.oldPrice)}</span>}
      </div>
      {product.ratingCount > 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          ★ {product.ratingAvg.toFixed(1)} ({product.ratingCount})
        </div>
      )}
    </Link>
  );
}

export function ProductGrid({ products }: { products: Card[] }) {
  return (
    <div className="grid">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
