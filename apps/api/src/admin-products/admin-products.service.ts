import { slugify } from '@david-store/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CategorySpecField, Prisma, ProductStatus, SpecFieldType, StockReason } from '@prisma/client';
import { randomBytes } from 'crypto';
import { CategoriesService } from '../catalog/categories.service';
import { ActivityLogService } from '../common/activity-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductListQuery, QuickEditDto, SaveProductDto, VariantDto } from './admin-products.dto';

const PAGE_SIZE = 25;

type Tx = Prisma.TransactionClient;

const listSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  publishAt: true,
  price: true,
  oldPrice: true,
  isFeatured: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  brand: { select: { name: true } },
  images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
  variants: { where: { isActive: true }, select: { id: true, name: true, sku: true, price: true, stock: true, lowStockThreshold: true } },
} satisfies Prisma.ProductSelect;

type ListRow = Prisma.ProductGetPayload<{ select: typeof listSelect }>;

const toRow = ({ images, variants, ...p }: ListRow) => ({
  ...p,
  image: images[0]?.url ?? null,
  variants,
  totalStock: variants.reduce((s, v) => s + v.stock, 0),
  lowStock: variants.some((v) => v.stock <= v.lowStockThreshold),
});

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
    private readonly activity: ActivityLogService,
  ) {}

  async list(query: ProductListQuery) {
    const where: Prisma.ProductWhereInput = {
      status: query.status && query.status !== 'ALL' ? (query.status as ProductStatus) : { not: ProductStatus.ARCHIVED },
      ...(query.categoryId ? { categoryId: { in: await this.categories.descendantIds(query.categoryId) } } : {}),
      ...(query.q?.trim()
        ? {
            OR: [
              { name: { contains: query.q.trim(), mode: 'insensitive' } },
              { variants: { some: { sku: { contains: query.q.trim(), mode: 'insensitive' } } } },
              { brand: { name: { contains: query.q.trim(), mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, select: listSelect, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      items: rows.map(toRow),
    };
  }

  private async listRow(id: string) {
    const row = await this.prisma.product.findUnique({ where: { id }, select: listSelect });
    return row ? toRow(row) : null;
  }

  async get(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        brand: { select: { name: true } },
        images: { orderBy: { sortOrder: 'asc' }, select: { url: true, alt: true } },
        variants: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return { ...product, brand: product.brand?.name ?? '', specFields: await this.categories.effectiveSpecFields(product.categoryId) };
  }

  async create(dto: SaveProductDto, actorId: string) {
    const house = await this.prisma.vendor.findFirstOrThrow({ where: { isHouse: true }, select: { id: true } });
    const prepared = await this.prepare(dto);
    const slug = await this.uniqueSlug(dto.name);

    const product = await this.withSkuCheck(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: { ...prepared.data, slug, vendorId: house.id, images: { create: prepared.images } },
        });
        for (const [i, v] of dto.variants.entries()) {
          await this.createVariant(tx, created.id, dto.name, v, i === 0, actorId);
        }
        return created;
      }),
    );
    await this.activity.record({ actorId, action: 'product.create', entityType: 'Product', entityId: product.id, after: { name: dto.name, status: dto.status } });
    return this.get(product.id);
  }

  async update(id: string, dto: SaveProductDto, actorId: string) {
    const existing = await this.prisma.product.findUnique({ where: { id }, include: { variants: { where: { isActive: true } } } });
    if (!existing) throw new NotFoundException('Product not found');
    const prepared = await this.prepare(dto);

    await this.withSkuCheck(() =>
      this.prisma.$transaction(async (tx) => {
        // The slug stays the same so links and search rankings keep working after a rename.
        await tx.product.update({ where: { id }, data: prepared.data });
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.productImage.createMany({ data: prepared.images.map((img) => ({ ...img, productId: id })) });

        const keep = new Set(dto.variants.filter((v) => v.id).map((v) => v.id!));
        for (const old of existing.variants.filter((v) => !keep.has(v.id))) {
          const used = await tx.orderItem.count({ where: { variantId: old.id } });
          // Variants that were ever ordered stay in the database (order history points at them).
          if (used) await tx.productVariant.update({ where: { id: old.id }, data: { isActive: false, isDefault: false } });
          else await tx.productVariant.delete({ where: { id: old.id } });
        }
        for (const [i, v] of dto.variants.entries()) {
          const old = v.id ? existing.variants.find((x) => x.id === v.id) : undefined;
          if (!old) {
            await this.createVariant(tx, id, dto.name, v, i === 0, actorId);
            continue;
          }
          await tx.productVariant.update({
            where: { id: old.id },
            data: {
              name: v.name.trim(),
              sku: v.sku?.trim().toUpperCase() || old.sku,
              price: v.price,
              oldPrice: v.oldPrice && v.oldPrice > v.price ? v.oldPrice : null,
              stock: v.stock,
              lowStockThreshold: v.lowStockThreshold ?? old.lowStockThreshold,
              options: { option: v.name.trim() },
              isDefault: i === 0,
            },
          });
          if (v.stock !== old.stock) await this.recordStock(tx, old.id, v.stock - old.stock, v.stock, actorId);
        }
      }),
    );
    await this.activity.record({ actorId, action: 'product.update', entityType: 'Product', entityId: id, before: { name: existing.name, status: existing.status, price: existing.price }, after: { name: dto.name, status: dto.status } });
    return this.get(id);
  }

  /** Price, stock or status straight from the product list. Price and stock only for single-variant products. */
  async quickEdit(id: string, dto: QuickEditDto, actorId: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: { variants: { where: { isActive: true } } } });
    if (!product) throw new NotFoundException('Product not found');
    if ((dto.price !== undefined || dto.stock !== undefined) && product.variants.length !== 1) {
      throw new BadRequestException('This product has several options; open it to change prices and stock');
    }
    const variant = product.variants[0];
    await this.prisma.$transaction(async (tx) => {
      if (dto.price !== undefined) {
        await tx.productVariant.update({ where: { id: variant.id }, data: { price: dto.price, oldPrice: variant.oldPrice && variant.oldPrice > dto.price ? variant.oldPrice : null } });
      }
      if (dto.stock !== undefined && dto.stock !== variant.stock) {
        await tx.productVariant.update({ where: { id: variant.id }, data: { stock: dto.stock } });
        await this.recordStock(tx, variant.id, dto.stock - variant.stock, dto.stock, actorId);
      }
      if (dto.status) {
        if (dto.status === ProductStatus.PUBLISHED && !(await tx.productImage.count({ where: { productId: id } }))) {
          throw new BadRequestException('Add at least one photo before publishing');
        }
        await tx.product.update({ where: { id }, data: { status: dto.status, publishAt: dto.status === ProductStatus.PUBLISHED ? new Date() : product.publishAt } });
      }
      await this.syncPrice(tx, id);
    });
    await this.activity.record({ actorId, action: 'product.quickEdit', entityType: 'Product', entityId: id, after: dto });
    return this.listRow(id);
  }

  /** A copy as a draft with no stock, for adding a similar item quickly. */
  async duplicate(id: string, actorId: string) {
    const source = await this.get(id);
    const dto: SaveProductDto = {
      name: `${source.name} (copy)`,
      categoryId: source.categoryId,
      brand: source.brand,
      description: source.description,
      keyFeatures: source.keyFeatures,
      inTheBox: source.inTheBox,
      specs: source.specs as Record<string, unknown>,
      images: source.images.map((i) => ({ url: i.url, alt: i.alt ?? undefined })),
      variants: source.variants.map((v) => ({ name: v.name, price: v.price, oldPrice: v.oldPrice, stock: 0, lowStockThreshold: v.lowStockThreshold })),
      status: ProductStatus.DRAFT,
      freeDelivery: source.freeDelivery,
      isFeatured: false,
      videoUrl: source.videoUrl,
      warranty: source.warranty,
    };
    return this.create(dto, actorId);
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async prepare(dto: SaveProductDto) {
    const category = await this.prisma.category.findUnique({ where: { id: dto.categoryId }, select: { id: true } });
    if (!category) throw new BadRequestException('Choose a category');
    if (dto.status !== ProductStatus.DRAFT && !dto.images.length) {
      throw new BadRequestException('Add at least one photo before publishing. Save as draft to finish later.');
    }

    const names = new Set<string>();
    for (const v of dto.variants) {
      const key = v.name.trim().toLowerCase();
      if (names.has(key)) throw new BadRequestException(`Two options are both called "${v.name}"`);
      names.add(key);
    }

    const brandName = dto.brand?.trim();
    const brand = brandName
      ? await this.prisma.brand.upsert({ where: { slug: slugify(brandName) }, update: {}, create: { name: brandName, slug: slugify(brandName) } })
      : null;

    const fields = await this.categories.effectiveSpecFields(dto.categoryId);
    const specs = this.cleanSpecs(fields, dto.specs, dto.status !== ProductStatus.DRAFT);
    const cheapest = [...dto.variants].sort((a, b) => a.price - b.price)[0];

    const data = {
      name: dto.name.trim(),
      categoryId: dto.categoryId,
      brandId: brand?.id ?? null,
      description: dto.description.trim(),
      keyFeatures: dto.keyFeatures.map((s) => s.trim()).filter(Boolean),
      inTheBox: dto.inTheBox.map((s) => s.trim()).filter(Boolean),
      specs: specs as Prisma.InputJsonValue,
      status: dto.status,
      publishAt: dto.status === ProductStatus.SCHEDULED ? new Date(dto.publishAt!) : dto.status === ProductStatus.PUBLISHED ? new Date() : null,
      price: cheapest.price,
      oldPrice: cheapest.oldPrice && cheapest.oldPrice > cheapest.price ? cheapest.oldPrice : null,
      freeDelivery: dto.freeDelivery ?? false,
      isFeatured: dto.isFeatured ?? false,
      videoUrl: dto.videoUrl || null,
      warranty: dto.warranty?.trim() || null,
      seoTitle: dto.seoTitle?.trim() || null,
      seoDescription: dto.seoDescription?.trim() || null,
    };
    const images = dto.images.map((img, i) => ({ url: img.url, alt: img.alt?.trim() || `${data.name}${i ? ` photo ${i + 1}` : ''}`, sortOrder: i }));
    return { data, images };
  }

  /**
   * Keeps only the category's own fields, in the right type. Required fields are enforced
   * when publishing; a draft may be incomplete.
   */
  private cleanSpecs(fields: CategorySpecField[], input: Record<string, unknown>, enforceRequired: boolean) {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = input[f.key];
      const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length);
      if (empty) {
        if (f.required && enforceRequired) throw new BadRequestException(`Fill in "${f.label}"`);
        continue;
      }
      switch (f.type) {
        case SpecFieldType.NUMBER: {
          const n = Number(raw);
          if (!Number.isFinite(n)) throw new BadRequestException(`"${f.label}" must be a number`);
          out[f.key] = n;
          break;
        }
        case SpecFieldType.BOOLEAN:
          out[f.key] = raw === true || raw === 'true';
          break;
        case SpecFieldType.SELECT:
          if (!f.options.includes(String(raw))) throw new BadRequestException(`Pick one of the listed options for "${f.label}"`);
          out[f.key] = String(raw);
          break;
        case SpecFieldType.MULTI_SELECT: {
          const values = (Array.isArray(raw) ? raw : [raw]).map(String).filter((v) => f.options.includes(v));
          if (values.length) out[f.key] = values;
          break;
        }
        default:
          out[f.key] = String(raw).trim().slice(0, 200);
      }
    }
    return out;
  }

  private async createVariant(tx: Tx, productId: string, productName: string, v: VariantDto, isDefault: boolean, actorId: string) {
    const sku = v.sku?.trim().toUpperCase() || this.makeSku(productName, v.name);
    const variant = await tx.productVariant.create({
      data: {
        productId,
        sku,
        name: v.name.trim(),
        options: { option: v.name.trim() },
        price: v.price,
        oldPrice: v.oldPrice && v.oldPrice > v.price ? v.oldPrice : null,
        stock: v.stock,
        lowStockThreshold: v.lowStockThreshold ?? 5,
        isDefault,
      },
    });
    if (v.stock > 0) await this.recordStock(tx, variant.id, v.stock, v.stock, actorId, StockReason.RESTOCK);
  }

  private recordStock(tx: Tx, variantId: string, change: number, stockAfter: number, actorId: string, reason: StockReason = StockReason.ADJUSTMENT) {
    return tx.stockMovement.create({ data: { variantId, change, stockAfter, reason, actorId, note: 'Edited in admin' } });
  }

  /** Product.price is the cheapest active option, used for sorting and price filters. */
  private async syncPrice(tx: Tx, productId: string) {
    const cheapest = await tx.productVariant.findFirst({ where: { productId, isActive: true }, orderBy: { price: 'asc' } });
    if (cheapest) await tx.product.update({ where: { id: productId }, data: { price: cheapest.price, oldPrice: cheapest.oldPrice } });
  }

  private makeSku(productName: string, option: string) {
    const base = slugify(productName).split('-').slice(0, 3).join('-').toUpperCase().slice(0, 24);
    const opt = slugify(option).toUpperCase().slice(0, 10);
    return `${base}-${opt}-${randomBytes(2).toString('hex').toUpperCase()}`;
  }

  private async uniqueSlug(name: string) {
    const base = slugify(name).slice(0, 80) || 'product';
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      if (!(await this.prisma.product.findUnique({ where: { slug }, select: { id: true } }))) return slug;
    }
  }

  private async withSkuCheck<T>(fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('That SKU is already used by another product. Change it or leave it empty.');
      }
      throw err;
    }
  }
}
