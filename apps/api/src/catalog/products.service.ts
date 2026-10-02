import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus, SpecFieldType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProductQueryDto } from './catalog.dto';
import { CategoriesService } from './categories.service';

/** Live on the storefront: published, or scheduled with its time reached. */
export const visibleProduct = (): Prisma.ProductWhereInput => ({
  OR: [{ status: ProductStatus.PUBLISHED }, { status: ProductStatus.SCHEDULED, publishAt: { lte: new Date() } }],
});

const ORDER_BY: Record<string, Prisma.ProductOrderByWithRelationInput[]> = {
  popularity: [{ soldCount: 'desc' }, { viewCount: 'desc' }],
  'price-asc': [{ price: 'asc' }],
  'price-desc': [{ price: 'desc' }],
  newest: [{ createdAt: 'desc' }],
  rating: [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }],
};

const cardSelect = {
  id: true,
  name: true,
  slug: true,
  price: true,
  oldPrice: true,
  freeDelivery: true,
  ratingAvg: true,
  ratingCount: true,
  images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true, alt: true } },
  vendor: { select: { isOfficialStore: true } },
  variants: { where: { isActive: true }, select: { stock: true } },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

/** Shape used by every product grid: badges are worked out here so all pages agree. */
const toCard = ({ variants, vendor, images, ...p }: CardRow) => ({
  ...p,
  ratingAvg: Number(p.ratingAvg),
  image: images[0] ?? null,
  officialStore: vendor.isOfficialStore,
  outOfStock: variants.every((v) => v.stock <= 0),
});

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  /** Product grid with filters; see ProductQueryDto.spec for the spec filter format. */
  async list(query: ProductQueryDto) {
    const where: Prisma.ProductWhereInput[] = [visibleProduct()];

    if (query.category) {
      const category = await this.categories.findActiveBySlug(query.category);
      where.push({ categoryId: { in: await this.categories.descendantIds(category.id) } });
      if (query.spec) where.push(...(await this.specFilters(category.id, query.spec)));
    }
    if (query.brand) where.push({ brand: { slug: { in: query.brand.split(',') } } });
    if (query.minPrice !== undefined) where.push({ price: { gte: query.minPrice } });
    if (query.maxPrice !== undefined) where.push({ price: { lte: query.maxPrice } });
    if (query.minRating) where.push({ ratingAvg: { gte: query.minRating } });

    let searchOrder: string[] | null = null;
    if (query.q?.trim()) {
      searchOrder = await this.searchIds(query.q.trim());
      where.push({ id: { in: searchOrder } });
    }

    const filter: Prisma.ProductWhereInput = { AND: where };
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where: filter }),
      this.prisma.product.findMany({
        where: filter,
        select: cardSelect,
        // With a search and no explicit sort, keep the best matches first.
        orderBy: searchOrder && !query.sort ? undefined : ORDER_BY[query.sort ?? 'popularity'],
        skip: searchOrder && !query.sort ? undefined : (query.page - 1) * query.pageSize,
        take: searchOrder && !query.sort ? undefined : query.pageSize,
      }),
    ]);

    let items = rows;
    if (searchOrder && !query.sort) {
      const rank = new Map(searchOrder.map((id, i) => [id, i]));
      items = rows
        .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
        .slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    }

    return { items: items.map(toCard), total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * Typo-tolerant search over product name, brand and category using PostgreSQL trigrams:
   * word_similarity matches a misspelt word inside a long name ("speeker" finds "Party
   * Speaker 100W"), and "samsung" or "laptops" find products by brand or category. It misses
   * swapped letters ("dorne"); Meilisearch handles those when the catalogue grows.
   */
  async searchIds(q: string, limit = 200) {
    // Exact substring matches win; fuzzy matching is only the fallback for misspellings,
    // otherwise "samsung" would also pull in everything starting with "sam".
    const exact = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM "Product" p
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      JOIN "Category" c ON c.id = p."categoryId"
      WHERE p.status IN ('PUBLISHED', 'SCHEDULED')
        AND concat_ws(' ', p.name, b.name, c.name) ILIKE ${'%' + q + '%'}
      ORDER BY (p.name ILIKE ${'%' + q + '%'}) DESC, p."soldCount" DESC
      LIMIT ${limit}`;
    if (exact.length) return exact.map((r) => r.id);

    // 0.4 keeps real typos ("speeker" 0.45, "camra" 0.5) and drops near-misses ("watches" vs "waterproof" 0.38).
    const fuzzy = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM (
        SELECT p.id, p.name, concat_ws(' ', p.name, b.name, c.name) AS haystack
        FROM "Product" p
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        JOIN "Category" c ON c.id = p."categoryId"
        WHERE p.status IN ('PUBLISHED', 'SCHEDULED')
      ) p
      WHERE word_similarity(${q}, p.haystack) >= 0.4
      ORDER BY word_similarity(${q}, p.name) DESC, word_similarity(${q}, p.haystack) DESC
      LIMIT ${limit}`;
    return fuzzy.map((r) => r.id);
  }

  /** Autocomplete for the search box. */
  async suggest(q: string) {
    if (q.trim().length < 2) return [];
    const ids = await this.searchIds(q.trim(), 8);
    const rows = await this.prisma.product.findMany({
      where: { AND: [visibleProduct(), { id: { in: ids } }] },
      select: { id: true, name: true, slug: true, price: true, images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } },
    });
    const rank = new Map(ids.map((id, i) => [id, i]));
    return rows
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
      .map(({ id: _id, images, ...r }) => ({ ...r, image: images[0]?.url ?? null }));
  }

  async detail(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { AND: [visibleProduct(), { slug }] },
      include: {
        brand: { select: { name: true, slug: true } },
        category: { select: { id: true, name: true, slug: true } },
        vendor: { select: { businessName: true, slug: true, isOfficialStore: true, ratingAvg: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { price: 'asc' }] },
        reviews: {
          where: { status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, rating: true, title: true, body: true, photos: true, createdAt: true, user: { select: { name: true } } },
        },
        questions: {
          where: { status: 'APPROVED', answer: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, question: true, answer: true, answeredAt: true },
        },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    void this.prisma.product.update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);

    const [similar, specFields, breadcrumb] = await Promise.all([
      this.prisma.product.findMany({
        where: { AND: [visibleProduct(), { categoryId: product.categoryId, id: { not: product.id } }] },
        select: cardSelect,
        orderBy: { soldCount: 'desc' },
        take: 12,
      }),
      this.categories.effectiveSpecFields(product.categoryId),
      this.categories.ancestors(product.categoryId),
    ]);

    return {
      ...product,
      category: { ...product.category, specFields },
      breadcrumb,
      ratingAvg: Number(product.ratingAvg),
      vendor: { ...product.vendor, ratingAvg: Number(product.vendor.ratingAvg) },
      reviews: product.reviews.map(({ user, ...r }) => ({ ...r, author: user.name.split(' ')[0] })),
      similar: similar.map(toCard),
    };
  }

  /** Homepage rows. Recently viewed is kept in the browser, so it isn't here. */
  async homeRows() {
    const visible = visibleProduct();
    const [featured, newArrivals, bestSellers, topDeals] = await Promise.all([
      this.prisma.product.findMany({ where: { AND: [visible, { isFeatured: true }] }, select: cardSelect, take: 12 }),
      this.prisma.product.findMany({ where: visible, select: cardSelect, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.prisma.product.findMany({ where: visible, select: cardSelect, orderBy: { soldCount: 'desc' }, take: 12 }),
      this.prisma.product.findMany({ where: { AND: [visible, { oldPrice: { not: null } }] }, select: cardSelect, take: 12 }),
    ]);
    return {
      featured: featured.map(toCard),
      newArrivals: newArrivals.map(toCard),
      bestSellers: bestSellers.map(toCard),
      topDeals: topDeals.map(toCard),
    };
  }

  private async specFilters(categoryId: string, spec: string) {
    const wanted = new Map(
      spec.split('|').map((part) => {
        const at = part.indexOf(':');
        return [part.slice(0, at), part.slice(at + 1)] as const;
      }),
    );
    // Only keys defined for this category (or inherited) are used, so arbitrary JSON paths can't be queried.
    const fields = await this.categories.effectiveSpecFields(categoryId, true);
    const filters: Prisma.ProductWhereInput[] = [];

    for (const field of fields) {
      const raw = wanted.get(field.key);
      if (!raw) continue;
      const path = [field.key];

      if (field.type === SpecFieldType.NUMBER) {
        const [min, max] = raw.split('-').map((v) => (v === '' ? undefined : Number(v)));
        if (min !== undefined && !Number.isNaN(min)) filters.push({ specs: { path, gte: min } });
        if (max !== undefined && !Number.isNaN(max)) filters.push({ specs: { path, lte: max } });
      } else if (field.type === SpecFieldType.BOOLEAN) {
        filters.push({ specs: { path, equals: raw === 'true' } });
      } else if (field.type === SpecFieldType.MULTI_SELECT) {
        filters.push({ OR: raw.split(',').map((v) => ({ specs: { path, array_contains: [v] } })) });
      } else {
        filters.push({ OR: raw.split(',').map((v) => ({ specs: { path, equals: v } })) });
      }
    }
    return filters;
  }
}
