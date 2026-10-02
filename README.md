# Davo

Davo is David's online store for Ghana, modelled on Jumia. He sells across every category, paid with MoMo or card through Hubtel or cash on delivery. The project spec lives in Claude Docs: "David's E-Commerce Platform — Project Specification".

## Layout

| Path | What | Port |
| --- | --- | --- |
| `apps/api` | NestJS + Prisma API, one for all three apps | 3000 |
| `apps/web` | Storefront (Vite + React, installable PWA) with the rider view at `/rider` | 5173 |
| `apps/admin` | Admin dashboard (Vite + React) | 5174 |
| `brand/` | Davo logo files, colours and usage rules | |
| `packages/shared` | Types and helpers both sides use: money, order statuses, the starter category tree | |

## Run it locally

Needs Node 22, pnpm 10 and PostgreSQL (local Postgres 18, user `postgres`/`postgres`).

```sh
pnpm install
cp apps/api/.env.example apps/api/.env      # then set JWT_ACCESS_SECRET and SEED_ADMIN_EMAIL
createdb -U postgres david_store
pnpm db:migrate                              # applies prisma/migrations
pnpm db:seed                                 # admin, starter category tree + filters, zones, settings, 6 sample products
pnpm dev                                     # api, web and admin together
```

The seed prints the admin password when `SEED_ADMIN_PASSWORD` is empty. The six "Sample …" products are for development only, so delete them before launch.

**Admin passwords:** each admin changes their own in Admin › Settings › Your account. If someone is locked out, run `pnpm --filter @david-store/api admin:reset-password <email>` with `DATABASE_URL` pointing at the right database; it prints a temporary password once and signs that account out everywhere.

## Decisions worth knowing

- **Money is integer pesewas** everywhere (GH₵ 1.00 = 100). Use `formatGhs` and `toPesewas` from `@david-store/shared`.
- **Vendors from day one.** Every product belongs to a `Vendor`. At launch there is one house vendor (`isHouse`). Each `Order` has one `OrderPackage` per vendor, which holds delivery status, the rider, pay-on-delivery cash and vendor earnings. Phase 2 adds vendor sign-up and screens with no data migration.
- **Categories are a tree David manages.** The seed adds a Jumia-style starter tree (56 categories) that David renames, hides and extends in the admin dashboard (Categories page, `/api/admin/categories`). The seed never overwrites his edits. A category page at any level lists products from all its sub-categories.
- **Category fields drive filters and forms.** `CategorySpecField` rows (battery life, storage, screen size…) feed the storefront filters and, later, the admin product form. Sub-categories inherit their ancestors' fields: Smartphones gets Phones & Tablets' storage, RAM and network filters. Product values live in `Product.specs` (JSON, GIN-indexed). Filter URL format is `?spec=batteryHours:10-20|ipRating:IPX7,IP67`.
- **Search** covers product name, brand and category. Exact matches come first; if there are none, PostgreSQL `pg_trgm` fuzzy matching (`word_similarity` of 0.4 or more) catches typos such as "speeker" and "camra". It misses swapped letters ("dorne"). With every category on sale, plan on Meilisearch once the catalogue reaches a few thousand products.
- **Hubtel payments** (`apps/api/src/payments`). The API starts a Hubtel Online Checkout and sends the customer there. An order is marked paid only after Hubtel's **transaction status check** confirms it. The callback alone is never trusted, and settling is idempotent. Hubtel's status API only answers from whitelisted IPs, so the API host needs a fixed outbound IP. Endpoint URLs follow Hubtel's docs; check them against developers.hubtel.com before go-live.
- **Auth.** Short-lived JWT access token (in memory) plus a rotating refresh token in an httpOnly cookie (`ds_refresh`, stored hashed). Reusing a rotated refresh token revokes every session for that user. Roles: CUSTOMER, SUPER_ADMIN, STAFF (with per-area `permissions`), VENDOR, RIDER. Use `@UseGuards(JwtAuthGuard)` with `@Roles(...)` and `@RequirePermission(...)`.
- **Share previews and SEO.** The storefront is a single-page app, so `apps/web/vercel.json` sends link-preview bots (WhatsApp, Facebook, X, Google) on `/p/:slug` and `/c/:slug` to `/api/seo/...`. That returns `index.html` with the title, Open Graph tags and product JSON-LD filled in. `/sitemap.xml` is served by the API too.
- **Same-origin API in production.** Both Vercel projects rewrite `/api/*` to the API host, so the refresh cookie is first-party. The API host is set in both `vercel.json` files.

## Built so far vs. next

Built: full database schema and first migration; seed; auth (register, login, refresh, logout, me); catalogue (category tree at any depth with inherited filters and breadcrumbs, admin category and filter management, product grid with brand/price/rating/spec filters and sorting, search and autocomplete, product page, home rows); Hubtel checkout, callback and verify; share previews and sitemap. Storefront pages: home, category with filters, product, search, payment return. Admin: sign-in, section shell, product list, categories and filters.

Next (core store phase): cart and guest cart merge, checkout and order creation (stock reservation, delivery fee by zone, coupons, pay-on-delivery cap), customer account pages, admin product CRUD with Cloudinary uploads and CSV import, order management, and notifications (Redis + BullMQ for SMS, email and WhatsApp).
