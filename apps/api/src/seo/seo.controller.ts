import { Controller, Get, Header, Logger, NotFoundException, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatGhs } from '@david-store/shared';
import { SkipThrottle } from '@nestjs/throttler';
import { visibleProduct } from '../catalog/products.service';
import { PrismaService } from '../prisma/prisma.service';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TEMPLATE_TTL_MS = 5 * 60_000;

/**
 * The storefront is a Vite single-page app, so link-preview bots (WhatsApp, Facebook, X)
 * would see an empty page. The storefront host rewrites bot requests for /p/:slug and
 * /c/:slug here (see apps/web/vercel.json); we return the app's index.html with the
 * title, Open Graph tags and product JSON-LD filled in. People get the normal app.
 */
@Controller('seo')
@SkipThrottle()
export class SeoController {
  private readonly logger = new Logger(SeoController.name);
  private template: { html: string; fetchedAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
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
        variants: { where: { isActive: true }, select: { stock: true } },
      },
    });
    if (!p) throw new NotFoundException();

    const url = `${this.storefront()}/p/${p.slug}`;
    const title = p.seoTitle ?? `${p.name} | ${formatGhs(p.price)}`;
    const description = p.seoDescription ?? p.description.slice(0, 160);
    const inStock = p.variants.some((v) => v.stock > 0);
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      description,
      image: p.images.map((i) => i.url),
      brand: p.brand ? { '@type': 'Brand', name: p.brand.name } : undefined,
      sku: p.id,
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'GHS',
        price: (p.price / 100).toFixed(2),
        availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
      aggregateRating: p.ratingCount
        ? { '@type': 'AggregateRating', ratingValue: Number(p.ratingAvg), reviewCount: p.ratingCount }
        : undefined,
    };

    return this.render({ title, description, url, image: p.images[0]?.url, type: 'product', jsonLd });
  }

  @Get('c/:slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  async category(@Param('slug') slug: string) {
    const c = await this.prisma.category.findFirst({ where: { slug, isActive: true } });
    if (!c) throw new NotFoundException();
    return this.render({
      title: c.seoTitle ?? `${c.name}: ${c.tagline ?? ''}`.trim(),
      description: c.seoDescription ?? (c.description ?? '').slice(0, 160),
      url: `${this.storefront()}/c/${c.slug}`,
      image: c.bannerUrl ?? undefined,
      type: 'website',
    });
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=3600')
  async sitemap() {
    const base = this.storefront();
    const [categories, products] = await Promise.all([
      this.prisma.category.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } }),
      this.prisma.product.findMany({ where: visibleProduct(), select: { slug: true, updatedAt: true } }),
    ]);
    const entry = (loc: string, lastmod?: Date) =>
      `<url><loc>${escape(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : ''}</url>`;
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      entry(`${base}/`),
      ...categories.map((c) => entry(`${base}/c/${c.slug}`, c.updatedAt)),
      ...products.map((p) => entry(`${base}/p/${p.slug}`, p.updatedAt)),
      '</urlset>',
    ].join('\n');
  }

  private async render(meta: { title: string; description: string; url: string; image?: string; type: string; jsonLd?: unknown }) {
    const tags = [
      `<title>${escape(meta.title)}</title>`,
      `<meta name="description" content="${escape(meta.description)}">`,
      `<link rel="canonical" href="${escape(meta.url)}">`,
      `<meta property="og:type" content="${meta.type}">`,
      `<meta property="og:title" content="${escape(meta.title)}">`,
      `<meta property="og:description" content="${escape(meta.description)}">`,
      `<meta property="og:url" content="${escape(meta.url)}">`,
      meta.image ? `<meta property="og:image" content="${escape(meta.image)}">` : '',
      `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
      meta.jsonLd ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
    ].join('\n    ');

    const html = await this.indexHtml();
    return html.replace(/<title>[\s\S]*?<\/title>/, '').replace('</head>', `    ${tags}\n  </head>`);
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
      if (!this.template) return '<!doctype html><html><head></head><body></body></html>';
    }
    return this.template!.html;
  }

  private storefront() {
    return this.config.getOrThrow<string>('STOREFRONT_URL').replace(/\/$/, '');
  }
}
