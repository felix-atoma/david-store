/** Same-origin in dev (Vite proxy) and production (Vercel rewrite), so the refresh cookie just works. */
const BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message ?? 'Something went wrong. Please try again.');
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  price: number;
  oldPrice: number | null;
  freeDelivery: boolean;
  ratingAvg: number;
  ratingCount: number;
  image: { url: string; alt: string | null } | null;
  officialStore: boolean;
  outOfStock: boolean;
}

export interface SpecField {
  key: string;
  label: string;
  type: 'NUMBER' | 'TEXT' | 'SELECT' | 'MULTI_SELECT' | 'BOOLEAN';
  unit: string | null;
  options: string[];
}

export interface CategoryPage {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  bannerUrl: string | null;
  /** Root first, this category last. */
  breadcrumb: { id: string; name: string; slug: string }[];
  children: { name: string; slug: string }[];
  specFields: SpecField[];
  brands: { name: string; slug: string }[];
  priceRange: { min: number; max: number };
}

export interface ProductList {
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
}
