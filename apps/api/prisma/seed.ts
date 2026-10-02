import { STARTER_CATEGORIES, toPesewas, type CategoryDef } from '@david-store/shared';
import { PrismaClient, ProductStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase().trim();
  if (!email) {
    console.log('SEED_ADMIN_EMAIL is empty; skipping the super admin.');
    return;
  }
  if (await prisma.user.findUnique({ where: { email } })) return;

  const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  await prisma.user.create({
    data: {
      email,
      name: process.env.SEED_ADMIN_NAME || 'Store owner',
      role: Role.SUPER_ADMIN,
      passwordHash: await bcrypt.hash(password, 12),
      emailVerifiedAt: new Date(),
    },
  });
  if (!process.env.SEED_ADMIN_PASSWORD) console.log(`Super admin ${email} created with password: ${password}`);
}

async function seedCatalog() {
  const house = await prisma.vendor.upsert({
    where: { slug: 'official-store' },
    update: {},
    create: {
      slug: 'official-store',
      businessName: 'Official Store',
      isHouse: true,
      isOfficialStore: true,
      status: 'APPROVED',
      approvedAt: new Date(),
      wallet: { create: {} },
    },
  });

  for (const [i, def] of STARTER_CATEGORIES.entries()) await seedCategory(def, null, i);
  return house;
}

/** Creates missing categories only; never overwrites what David has edited in the dashboard. */
async function seedCategory(def: CategoryDef, parentId: string | null, sortOrder: number) {
  const category =
    (await prisma.category.findUnique({ where: { slug: def.slug } })) ??
    (await prisma.category.create({
      data: {
        slug: def.slug,
        name: def.name,
        tagline: def.tagline,
        description: def.description,
        isFeatured: def.featured ?? false,
        parentId,
        sortOrder,
      },
    }));

  for (const [order, field] of (def.specFields ?? []).entries()) {
    if (await prisma.categorySpecField.findUnique({ where: { categoryId_key: { categoryId: category.id, key: field.key } } })) continue;
    await prisma.categorySpecField.create({
      data: {
        categoryId: category.id,
        key: field.key,
        label: field.label,
        type: field.type,
        unit: field.unit,
        options: field.options ?? [],
        required: field.required ?? false,
        filterable: field.filterable ?? true,
        sortOrder: order,
      },
    });
  }
  for (const [i, child] of (def.children ?? []).entries()) await seedCategory(child, category.id, i);
}

/** Placeholder zones and fees until David supplies the real ones. */
async function seedDelivery() {
  if (await prisma.deliveryZone.count()) return;
  const accra = await prisma.deliveryZone.create({
    data: { name: 'Accra Central', areas: ['Osu', 'Labone', 'Airport', 'East Legon', 'Cantonments', 'Adabraka'], fee: toPesewas(25), minDays: 1, maxDays: 2, sortOrder: 0 },
  });
  await prisma.deliveryZone.create({
    data: { name: 'Greater Accra', areas: ['Greater Accra'], fee: toPesewas(40), minDays: 1, maxDays: 3, sortOrder: 1 },
  });
  await prisma.deliveryZone.create({
    data: { name: 'Other regions', areas: ['Ashanti', 'Central', 'Eastern', 'Volta', 'Western', 'Northern'], fee: toPesewas(70), minDays: 3, maxDays: 6, sortOrder: 2 },
  });
  await prisma.pickupStation.create({
    data: { zoneId: accra.id, name: 'Main pickup point', address: 'To be confirmed', fee: toPesewas(10) },
  });
}

async function seedSettings() {
  const settings: Record<string, unknown> = {
    'store.name': 'David Store',
    'store.whatsapp': '',
    'delivery.freeThreshold': toPesewas(1000),
    'payments.podMaxOrder': toPesewas(3000),
    'returns.windowDays': 7,
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.storeSetting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }
  for (const key of ['about', 'returns-policy', 'privacy-policy', 'terms']) {
    await prisma.page.upsert({
      where: { slug: key },
      update: {},
      create: { slug: key, title: key.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), body: 'To be written.' },
    });
  }
}

/** Sample items so the storefront has something to show in development. Delete before launch. */
async function seedSampleProducts(vendorId: string) {
  // Once real products exist, leave the catalogue alone.
  if (await prisma.product.count({ where: { slug: { not: { startsWith: 'sample-' } } } })) return;
  const cat = async (slug: string) => (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;
  const brand = async (name: string) =>
    (await prisma.brand.upsert({ where: { slug: name.toLowerCase() }, update: {}, create: { name, slug: name.toLowerCase() } })).id;

  const samples = [
    { name: 'Sample Waterproof Speaker 20W', slug: 'sample-waterproof-speaker-20w', categoryId: await cat('bluetooth-speakers'), brandId: await brand('JBL'), price: 1150, oldPrice: 1400, specs: { batteryHours: 12, ipRating: 'IPX7', wattage: 20, connectivity: ['Bluetooth 5.x', 'TWS pairing'] }, colours: ['Black', 'Blue'] },
    { name: 'Sample Party Speaker 100W', slug: 'sample-party-speaker-100w', categoryId: await cat('bluetooth-speakers'), brandId: await brand('Sony'), price: 3900, oldPrice: null, specs: { batteryHours: 18, ipRating: 'IPX4', wattage: 100, connectivity: ['Bluetooth 5.x', 'AUX', 'USB'] }, colours: ['Black'] },
    { name: 'Sample Mini Drone 4K', slug: 'sample-mini-drone-4k', categoryId: await cat('drones'), brandId: await brand('DJI'), price: 8500, oldPrice: 9200, specs: { type: 'Drone', videoResolution: '4K', flightMinutes: 31, rangeMeters: 10000, skillLevel: 'Beginner' }, colours: ['Grey'] },
    { name: 'Sample Action Camera 5.3K', slug: 'sample-action-camera-5-3k', categoryId: await cat('action-cameras'), brandId: await brand('GoPro'), price: 5200, oldPrice: null, specs: { type: 'Action camera', videoResolution: '5.3K', skillLevel: 'Intermediate' }, colours: ['Black'] },
    { name: 'Sample Smartphone 128GB', slug: 'sample-smartphone-128gb', categoryId: await cat('smartphones'), brandId: await brand('Samsung'), price: 2800, oldPrice: 3100, specs: { storage: '128GB', ram: '6GB', screenInches: 6.6, network: '5G', dualSim: true }, colours: ['Black', 'Mint'] },
    { name: 'Sample Leather Wristwatch', slug: 'sample-leather-wristwatch', categoryId: await cat('watches'), brandId: await brand('Casio'), price: 650, oldPrice: null, specs: { material: 'Leather strap' }, colours: ['Brown'] },
  ];

  for (const s of samples) {
    if (await prisma.product.findUnique({ where: { slug: s.slug } })) continue;
    await prisma.product.create({
      data: {
        vendorId,
        categoryId: s.categoryId,
        brandId: s.brandId,
        name: s.name,
        slug: s.slug,
        description: 'Sample product for development. Replace with David’s real catalogue.',
        keyFeatures: ['Sample feature one', 'Sample feature two'],
        inTheBox: ['Main unit', 'USB-C cable'],
        specs: s.specs,
        status: ProductStatus.PUBLISHED,
        price: toPesewas(s.price),
        oldPrice: s.oldPrice ? toPesewas(s.oldPrice) : null,
        isFeatured: true,
        variants: {
          create: s.colours.map((colour, i) => ({
            sku: `${s.slug}-${colour}`.toUpperCase(),
            name: colour,
            options: { colour },
            price: toPesewas(s.price),
            oldPrice: s.oldPrice ? toPesewas(s.oldPrice) : null,
            stock: 10,
            isDefault: i === 0,
          })),
        },
      },
    });
  }
}

async function main() {
  await seedAdmin();
  const house = await seedCatalog();
  await seedDelivery();
  await seedSettings();
  await seedSampleProducts(house.id);
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
