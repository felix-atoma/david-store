import { formatGhs } from '@david-store/shared';
import { useEffect, useState } from 'react';
import { api, type ProductList } from '../api';

/**
 * Read-only for now, using the public catalogue endpoint. The admin product endpoints
 * (drafts, quick-edit, CSV upload) replace this in the core store phase.
 */
export default function Products() {
  const [list, setList] = useState<ProductList | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<ProductList>('/products?pageSize=60&sort=newest').then(setList).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <h1>Products</h1>
      {error && <p className="error">{error}</p>}
      {list && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Price</th>
              <th>Old price</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{formatGhs(p.price)}</td>
                <td>{p.oldPrice ? formatGhs(p.oldPrice) : ''}</td>
                <td>{p.outOfStock ? 'Out of stock' : 'In stock'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
