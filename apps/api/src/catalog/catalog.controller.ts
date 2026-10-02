import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductQueryDto } from './catalog.dto';
import { CategoriesService } from './categories.service';
import { ProductsService, visibleProduct } from './products.service';

@Controller()
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly prisma: PrismaService,
  ) {}

  /** Full category tree for the mega menu. */
  @Get('categories')
  tree() {
    return this.categories.tree();
  }

  /**
   * Landing page for a category at any level: banner, tagline, description, breadcrumb,
   * sub-categories, and the filters that apply (its own spec fields plus inherited ones).
   */
  @Get('categories/:slug')
  async category(@Param('slug') slug: string) {
    const category = await this.categories.findActiveBySlug(slug);
    const ids = await this.categories.descendantIds(category.id);
    const inCategory = { AND: [visibleProduct(), { categoryId: { in: ids } }] };

    const [breadcrumb, specFields, children, banners, brands, price] = await Promise.all([
      this.categories.ancestors(category.id),
      this.categories.effectiveSpecFields(category.id, true),
      this.prisma.category.findMany({
        where: { parentId: category.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { name: true, slug: true, iconUrl: true },
      }),
      this.prisma.banner.findMany({ where: { categoryId: category.id, isActive: true, placement: 'CATEGORY' }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.brand.findMany({ where: { products: { some: inCategory } }, orderBy: { name: 'asc' }, select: { name: true, slug: true } }),
      this.prisma.product.aggregate({ where: inCategory, _min: { price: true }, _max: { price: true } }),
    ]);

    return {
      ...category,
      breadcrumb,
      specFields,
      children,
      banners,
      brands,
      priceRange: { min: price._min.price ?? 0, max: price._max.price ?? 0 },
    };
  }

  @Get('products')
  list(@Query() query: ProductQueryDto) {
    return this.products.list(query);
  }

  @Get('products/suggest')
  suggest(@Query('q') q = '') {
    return this.products.suggest(q);
  }

  @Get('products/:slug')
  detail(@Param('slug') slug: string) {
    return this.products.detail(slug);
  }

  @Get('home')
  async home() {
    const [rows, featuredCategories] = await Promise.all([
      this.products.homeRows(),
      this.prisma.category.findMany({
        where: { isActive: true, isFeatured: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { name: true, slug: true, tagline: true, iconUrl: true, bannerUrl: true },
      }),
    ]);
    return { ...rows, featuredCategories };
  }
}
