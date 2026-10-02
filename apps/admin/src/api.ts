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

const UPLOAD_MAX_SIDE = 2000;

/**
 * Phone photos are 4–10 MB; Vercel's proxy rejects bodies over ~4.5 MB and mobile data is slow.
 * Shrink in the browser first (upright, 2000 px, JPEG ~85%); the server makes the final WebP.
 * Formats the browser can't decode (e.g. some HEIC) go up unchanged.
 */
async function shrink(file: File): Promise<Blob> {
  if (file.size < 900_000 || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Sends one photo as multipart form data (the browser sets the boundary header itself). */
export async function uploadImage(file: File): Promise<{ id: string; url: string; width: number; height: number }> {
  const body = new FormData();
  body.append('file', await shrink(file), file.name.replace(/\.\w+$/, '') + '.jpg');
  const res = await fetch(`${BASE}/api/admin/media`, {
    method: 'POST',
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.message ?? (res.status === 413 ? 'That photo is too large (15 MB max).' : 'Upload failed. Please try again.'));
  }
  return res.json();
}

/** The public shop, for "View in store" links and photos that ship with the storefront. */
export const STOREFRONT_URL =
  import.meta.env.VITE_STOREFRONT_URL ?? (location.hostname === 'localhost' ? 'http://localhost:5173' : 'https://david-store-web.vercel.app');

/** Uploaded photos come through this site's /api; photos bundled with the storefront live there. */
export const imageSrc = (url: string | null | undefined) => (!url ? '' : url.startsWith('/products/') ? `${STOREFRONT_URL}${url}` : url);

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
