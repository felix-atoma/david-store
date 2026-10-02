import {
  categorySeoDescription,
  categorySeoTitle,
  formatGhs,
  productSeoDescription,
  productSeoTitle,
  STORE_NAME,
} from '@david-store/shared';
import { Controller, Get, Header, Logger, NotFoundException, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { CategoriesService } from '../catalog/categories.service';
import { visibleProduct } from '../catalog/products.service';
import { PrismaService } from '../prisma/prisma.service';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TEMPLATE_TTL_MS = 5 * 60_000;
const CATEGORY_LINKS = 60;

interface PageMeta {
  title: string;
  description: string;
  url: string;
  image?: string;
  type: 'product' | 'website';
  jsonLd: unknown[];
  /** Readable content for search bots, placed where the app would render. */
  body: string;
}

/**
 * The storefront is a Vite single-page app, so search and link-preview bots would see an empty
 * page. The storefront host rewrites bot requests for /p/:slug and /c/:slug here (see
 * apps/web/vercel.json); we return the app's index.html with the title, description, canonical
 * link, Open Graph tags, JSON-LD and a plain-HTML version of the page filled in. People get
 * the normal app. The homepage's tags are static, in apps/web/index.html.
 */
@Controller('seo')
@SkipThrottle()
export class SeoController {
  private readonly logger = new Logger(SeoController.name);
  private template: { html: string; fetchedAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly config: ConfigService,
  ) {}

  @Get('p/:slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  async product(@Param('slug') slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { AND: [visibleProduct(), { slug }] },
      include: {
        brand: { select: { name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 4 },
        variants: { where: { isActive: true }, select: { stock: true, sku: true } },
      },
    });
    if (!p) throw new NotFoundException();

    const base = this.storefront();
    const url = `${base}/p/${p.slug}`;
    const title = productSeoTitle(p);
    const description = productSeoDescription(p);
    const inStock = p.variants.some((v) => v.stock > 0);
    const crumbs = await this.categories.ancestors(p.categoryId);

    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      description: p.description,
      image: p.images.map((i) => this.absolute(i.url)),
      brand: p.brand ? { '@type': 'Brand', name: p.brand.name } : undefined,
      sku: p.variants[0]?.sku ?? p.id,
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'GHS',
        price: (p.price / 100).toFixed(2),
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: STORE_NAME },
      },
      aggregateRating: p.ratingCount ? { '@type': 'AggregateRating', ratingValue: Number(p.ratingAvg), reviewCount: p.ratingCount } : undefined,
    };

    const body = [
      this.breadcrumbHtml(crumbs, p.name),
      `<h1>${escape(p.name)}</h1>`,
      `<p><strong>${escape(formatGhs(p.price))}</strong>${p.oldPrice && p.oldPrice > p.price ? ` <s>${escape(formatGhs(p.oldPrice))}</s>` : ''} · ${inStock ? 'In stock' : 'Out of stock'}${p.brand ? ` · Brand: ${escape(p.brand.name)}` : ''}</p>`,
      p.images[0] ? `<img src="${escape(this.absolute(p.images[0].url))}" alt="${escape(p.images[0].alt ?? p.name)}" width="600" height="600">` : '',
      `<p>${escape(p.description)}</p>`,
      p.keyFeatures.length ? `<h2>Key features</h2><ul>${p.keyFeatures.map((f) => `<li>${escape(f)}</li>`).join('')}</ul>` : '',
      p.inTheBox.length ? `<h2>What's in the box</h2><ul>${p.inTheBox.map((f) => `<li>${escape(f)}</li>`).join('')}</ul>` : '',
      `<p>Delivery across Ghana. Pay with Mobile Money, card or cash on delivery.</p>`,
    ].join('\n');

    return this.render({
      title,
      description,
      url,
      image: p.images[0] ? this.absolute(p.images[0].url) : `${base}/og-image.png`,
      type: 'product',
      jsonLd: [product, this.breadcrumbLd(crumbs, { name: p.name, url })],
      body,
    });
  }

  @Get('c/:slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  async category(@Param('slug') slug: string) {
    const c = await this.prisma.category.findFirst({ where: { slug, isActive: true } });
    if (!c) throw new NotFoundException();

    const base = this.storefront();
    const url = `${base}/c/${c.slug}`;
    const ids = await this.categories.descendantIds(c.id);
    const inCategory = { AND: [visibleProduct(), { categoryId: { in: ids } }] };
    const [crumbs, children, products, brands] = await Promise.all([
      this.categories.ancestors(c.id),
      this.prisma.category.findMany({ where: { parentId: c.id, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { name: true, slug: true } }),
      this.prisma.product.findMany({ where: inCategory, orderBy: { soldCount: 'desc' }, take: CATEGORY_LINKS, select: { name: true, slug: true, price: true } }),
      this.prisma.brand.findMany({ where: { products: { some: inCategory } }, orderBy: { name: 'asc' }, select: { name: true } }),
    ]);

    const description = categorySeoDescription({ ...c, children: children.map((x) => x.name), brands: brands.map((b) => b.name) });
    const body = [
      this.breadcrumbHtml(crumbs.slice(0, -1), c.name),
      `<h1>${escape(c.name)}</h1>`,
      c.tagline ? `<p><strong>${escape(c.tagline)}</strong></p>` : '',
      `<p>${escape(c.description ?? description)}</p>`,
      children.length ? `<h2>Shop by type</h2><ul>${children.map((x) => `<li><a href="/c/${x.slug}">${escape(x.name)}</a></li>`).join('')}</ul>` : '',
      brands.length ? `<p>Brands: ${brands.map((b) => escape(b.name)).join(', ')}</p>` : '',
      products.length
        ? `<h2>${escape(c.name)} for sale in Ghana</h2><ul>${products.map((p) => `<li><a href="/p/${p.slug}">${escape(p.name)}</a>, ${escape(formatGhs(p.price))}</li>`).join('')}</ul>`
        : '',
    ].join('\n');

    return this.render({
      title: categorySeoTitle(c),
      description,
      url,
      image: c.bannerUrl ? this.absolute(c.bannerUrl) : `${base}/og-image.png`,
      type: 'website',
      jsonLd: [this.breadcrumbLd(crumbs.slice(0, -1), { name: c.name, url })],
      body,
    });
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemap() {
    const base = this.storefront();
    const [categories, products] = await Promise.all([
      this.prisma.category.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
      this.prisma.product.findMany({ where: visibleProduct(), select: { slug: true, updatedAt: true, images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } } }),
    ]);
    const entry = (loc: string, lastmod?: Date, image?: string) =>
      `<url><loc>${escape(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}${image ? `<image:image><image:loc>${escape(image)}</image:loc></image:image>` : ''}</url>`;
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
      entry(`${base}/`),
      ...categories.map((c) => entry(`${base}/c/${c.slug}`, c.updatedAt)),
      ...products.map((p) => entry(`${base}/p/${p.slug}`, p.updatedAt, p.images[0] ? this.absolute(p.images[0].url) : undefined)),
      '</urlset>',
    ].join('\n');
  }

  /** Lets search engines crawl the shop, keeps them out of checkout, orders and the rider app. */
  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  robots() {
    return ['User-agent: *', 'Allow: /', 'Disallow: /checkout', 'Disallow: /order/', 'Disallow: /rider', 'Disallow: /api/', '', `Sitemap: ${this.storefront()}/sitemap.xml`, ''].join('\n');
  }

  private breadcrumbHtml(trail: { name: string; slug: string }[], current: string) {
    const links = [`<a href="/">Home</a>`, ...trail.map((t) => `<a href="/c/${t.slug}">${escape(t.name)}</a>`), escape(current)];
    return `<nav aria-label="Breadcrumb">${links.join(' › ')}</nav>`;
  }

  private breadcrumbLd(trail: { name: string; slug: string }[], current: { name: string; url: string }) {
    const base = this.storefront();
    const items = [{ name: 'Home', url: `${base}/` }, ...trail.map((t) => ({ name: t.name, url: `${base}/c/${t.slug}` })), current];
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
    };
  }

  private async render(meta: PageMeta) {
    const tags = [
      `<title>${escape(meta.title)}</title>`,
      `<meta name="description" content="${escape(meta.description)}">`,
      `<link rel="canonical" href="${escape(meta.url)}">`,
      `<meta property="og:type" content="${meta.type}">`,
      `<meta property="og:site_name" content="${STORE_NAME}">`,
      `<meta property="og:locale" content="en_GH">`,
      `<meta property="og:title" content="${escape(meta.title)}">`,
      `<meta property="og:description" content="${escape(meta.description)}">`,
      `<meta property="og:url" content="${escape(meta.url)}">`,
      meta.image ? `<meta property="og:image" content="${escape(meta.image)}">` : '',
      `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
      ...meta.jsonLd.map((ld) => `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`),
    ]
      .filter(Boolean)
      .join('\n    ');

    // Drop the template's generic tags so each page has exactly one title, description and set of OG tags.
    const html = (await this.indexHtml())
      .replace(/<title>[\s\S]*?<\/title>\s*/, '')
      .replace(/<meta\s+name="description"[^>]*>\s*/gi, '')
      .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, '')
      .replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*/gi, '')
      .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '')
      .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\s*/gi, '');

    return html
      .replace('</head>', `    ${tags}\n  </head>`)
      .replace('<div id="root"></div>', `<div id="root"><main>\n${meta.body}\n</main></div>`);
  }

  /** The storefront's built index.html, cached briefly so new deploys are picked up. */
  private async indexHtml() {
    if (this.template && Date.now() - this.template.fetchedAt < TEMPLATE_TTL_MS) return this.template.html;
    try {
      const res = await fetch(`${this.storefront()}/index.html`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      this.template = { html: await res.text(), fetchedAt: Date.now() };
    } catch (err) {
      this.logger.warn(`Could not fetch storefront index.html: ${(err as Error).message}`);
      if (!this.template) return '<!doctype html><html lang="en-GH"><head></head><body><div id="root"></div></body></html>';
    }
    return this.template!.html;
  }

  /** Images uploaded to the storefront are stored as /products/...; bots need the full URL. */
  private absolute(url: string) {
    return url.startsWith('/') ? `${this.storefront()}${url}` : url;
  }

  private storefront() {
    return this.config.getOrThrow<string>('STOREFRONT_URL').replace(/\/$/, '');
  }
}
