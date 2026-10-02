import { slugify, toPesewas } from '@david-store/shared';
import { PrismaClient, ProductStatus } from '@prisma/client';
import { FIRST_PRODUCTS } from './catalogue/first-products';

/**
 * Loads products from prisma/catalogue into the database, keyed by slug, so it is safe to run
 * again after editing the data: prices, text and images are updated and nothing is duplicated.
 * Stock is only set when a variant is first created, so it never overwrites real stock counts.
 * A stand-in until the admin product form and CSV import exist.
 */
const prisma = new PrismaClient();

async function main() {
  const house = await prisma.vendor.findFirstOrThrow({ where: { isHouse: true } });

  for (const p of FIRST_PRODUCTS) {
    const category = await prisma.category.findUnique({ where: { slug: p.categorySlug } });
    if (!category) throw new Error(`Category "${p.categorySlug}" not found; run the seed first`);
    const brandSlug = slugify(p.brand);
    const brand = await prisma.brand.upsert({ where: { slug: brandSlug }, update: {}, create: { name: p.brand, slug: brandSlug } });

    const price = toPesewas(p.price);
    const data = {
      vendorId: house.id,
      categoryId: category.id,
      brandId: brand.id,
      name: p.name,
      description: p.description,
      keyFeatures: p.keyFeatures,
      inTheBox: p.inTheBox ?? [],
      specs: p.specs as object,
      price,
      status: ProductStatus.PUBLISHED,
    };
    const product = await prisma.product.upsert({ where: { slug: p.slug }, update: data, create: { ...data, slug: p.slug } });

    // Images: replace the set so edits to the list take effect.
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.createMany({
      data: p.images.map((img, i) => ({ productId: product.id, url: `/products/${img.file}`, alt: img.alt, sortOrder: i })),
    });

    const sku = `${p.slug}-${slugify(p.colour)}`.toUpperCase().slice(0, 64);
    await prisma.productVariant.upsert({
      where: { sku },
      update: { price, name: p.colour, options: { colour: p.colour } },
      create: { productId: product.id, sku, name: p.colour, options: { colour: p.colour }, price, stock: p.stock, isDefault: true },
    });
    console.log(`✓ ${p.name}  GH₵${p.price.toLocaleString('en-GH')}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
