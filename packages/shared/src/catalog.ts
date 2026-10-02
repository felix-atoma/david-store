export type SpecFieldType = 'NUMBER' | 'TEXT' | 'SELECT' | 'MULTI_SELECT' | 'BOOLEAN';

export interface SpecFieldDef {
  key: string;
  label: string;
  type: SpecFieldType;
  unit?: string;
  options?: string[];
  required?: boolean;
  filterable?: boolean;
}

export interface CategoryDef {
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  featured?: boolean;
  /** Inherited by every sub-category. */
  specFields?: SpecFieldDef[];
  children?: CategoryDef[];
}

const leaf = (slug: string, name: string, specFields?: SpecFieldDef[]): CategoryDef => ({ slug, name, specFields });

const STORAGE: SpecFieldDef = { key: 'storage', label: 'Storage', type: 'SELECT', options: ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB'] };
const RAM: SpecFieldDef = { key: 'ram', label: 'RAM', type: 'SELECT', options: ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '32GB'] };
const SCREEN: SpecFieldDef = { key: 'screenInches', label: 'Screen size', type: 'NUMBER', unit: 'inches' };

/**
 * Starting category tree, Jumia-style. David sells whatever he stocks, so this is only a
 * first draft: he renames, adds, hides and reorders categories from the admin dashboard.
 * The two featured categories carry the wording from the project specification.
 */
export const STARTER_CATEGORIES: CategoryDef[] = [
  {
    slug: 'audio-sound',
    name: 'Audio & Sound',
    featured: true,
    tagline: 'Immersive Sound, Anywhere.',
    description:
      'Bring your music to life with our collection of portable Bluetooth speakers. Engineered for crisp highs, deep bass, and rugged durability, these speakers are perfect for backyard parties, beach days, or studio-quality home listening. Waterproof, long-lasting battery, and seamless connectivity.',
    specFields: [
      { key: 'batteryHours', label: 'Battery life', type: 'NUMBER', unit: 'hours' },
      { key: 'ipRating', label: 'Waterproof rating', type: 'SELECT', options: ['None', 'IPX4', 'IPX5', 'IPX6', 'IPX7', 'IP67'] },
      { key: 'wattage', label: 'Output power', type: 'NUMBER', unit: 'W' },
      { key: 'connectivity', label: 'Connectivity', type: 'MULTI_SELECT', options: ['Bluetooth 5.x', 'AUX', 'USB', 'Wi-Fi', 'NFC', 'TWS pairing'] },
    ],
    children: [
      leaf('bluetooth-speakers', 'Bluetooth speakers'),
      leaf('headphones-earbuds', 'Headphones & earbuds'),
      leaf('soundbars-home-theatre', 'Soundbars & home theatre'),
    ],
  },
  {
    slug: 'aerial-photography',
    name: 'Aerial & Photography',
    featured: true,
    tagline: 'Capture the World from a New Perspective.',
    description:
      'From beginner-friendly mini drones to professional-grade 4K action cameras, we supply the gear to document your finest moments. Experience ultra-stable flight controls, crystal-clear imaging, and smart tracking features that make high-end photography effortless.',
    specFields: [
      { key: 'type', label: 'Type', type: 'SELECT', options: ['Drone', 'Action camera', 'Camera'] },
      { key: 'videoResolution', label: 'Video resolution', type: 'SELECT', options: ['1080p', '2.7K', '4K', '5.3K', '8K'] },
      { key: 'flightMinutes', label: 'Flight time', type: 'NUMBER', unit: 'min' },
      { key: 'rangeMeters', label: 'Range', type: 'NUMBER', unit: 'm' },
      { key: 'skillLevel', label: 'Skill level', type: 'SELECT', options: ['Beginner', 'Intermediate', 'Professional'] },
    ],
    children: [leaf('drones', 'Drones'), leaf('action-cameras', 'Action cameras'), leaf('camera-accessories', 'Camera accessories')],
  },
  {
    slug: 'phones-tablets',
    name: 'Phones & Tablets',
    featured: true,
    specFields: [
      STORAGE,
      RAM,
      SCREEN,
      { key: 'network', label: 'Network', type: 'SELECT', options: ['3G', '4G', '5G'] },
      { key: 'dualSim', label: 'Dual SIM', type: 'BOOLEAN' },
    ],
    children: [leaf('smartphones', 'Smartphones'), leaf('basic-phones', 'Basic phones'), leaf('tablets', 'Tablets'), leaf('phone-accessories', 'Phone accessories')],
  },
  {
    slug: 'computing',
    name: 'Computing',
    featured: true,
    specFields: [STORAGE, RAM, SCREEN, { key: 'processor', label: 'Processor', type: 'TEXT', filterable: false }],
    children: [leaf('laptops', 'Laptops'), leaf('desktops', 'Desktops'), leaf('printers', 'Printers'), leaf('computer-accessories', 'Computer accessories')],
  },
  {
    slug: 'electronics',
    name: 'Electronics',
    children: [
      leaf('televisions', 'Televisions', [SCREEN, { key: 'resolution', label: 'Resolution', type: 'SELECT', options: ['HD', 'Full HD', '4K', '8K'] }, { key: 'smartTv', label: 'Smart TV', type: 'BOOLEAN' }]),
      leaf('solar-power', 'Solar & power'),
      leaf('smart-home', 'Smart home'),
    ],
  },
  {
    slug: 'appliances',
    name: 'Appliances',
    specFields: [{ key: 'powerWatts', label: 'Power', type: 'NUMBER', unit: 'W' }],
    children: [
      leaf('kitchen-appliances', 'Kitchen appliances'),
      leaf('fridges-freezers', 'Fridges & freezers'),
      leaf('cooling', 'Air conditioners & fans'),
      leaf('washing-machines', 'Washing machines'),
    ],
  },
  {
    slug: 'fashion',
    name: 'Fashion',
    featured: true,
    // Size and colour are product variants, so they are not spec fields.
    specFields: [{ key: 'material', label: 'Material', type: 'TEXT', filterable: false }],
    children: [leaf('mens-fashion', "Men's fashion"), leaf('womens-fashion', "Women's fashion"), leaf('kids-fashion', "Kids' fashion"), leaf('watches', 'Watches'), leaf('bags', 'Bags')],
  },
  {
    slug: 'health-beauty',
    name: 'Health & Beauty',
    children: [leaf('makeup', 'Makeup'), leaf('hair-care', 'Hair care'), leaf('fragrances', 'Fragrances'), leaf('personal-care', 'Personal care')],
  },
  {
    slug: 'home-office',
    name: 'Home & Office',
    children: [leaf('furniture', 'Furniture'), leaf('kitchen-dining', 'Kitchen & dining'), leaf('bedding', 'Bedding'), leaf('office-supplies', 'Office supplies')],
  },
  {
    slug: 'supermarket',
    name: 'Supermarket',
    children: [leaf('food-cupboard', 'Food cupboard'), leaf('beverages', 'Beverages'), leaf('household-care', 'Household care')],
  },
  { slug: 'baby-products', name: 'Baby products' },
  {
    slug: 'gaming',
    name: 'Gaming',
    children: [leaf('consoles', 'Consoles'), leaf('video-games', 'Video games'), leaf('gaming-accessories', 'Gaming accessories')],
  },
  { slug: 'sporting-goods', name: 'Sporting goods' },
  { slug: 'automobile', name: 'Automobile', children: [leaf('car-electronics', 'Car electronics'), leaf('car-care', 'Car care')] },
];

export const PRODUCT_SORTS = ['popularity', 'price-asc', 'price-desc', 'newest', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const MAX_PRODUCT_IMAGES = 8;

/** "Men's Fashion & Shoes" → "mens-fashion-shoes" */
export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
