/**
 * David's first real products, from the photos he sent on 2026-10-02.
 *
 * PRICES AND STOCK ARE PLACEHOLDERS set by the developer, not David's prices: David must
 * confirm them (and real stock counts) before launch. Specs and features only state what the
 * photos themselves show; anything else is left blank for David to fill in.
 *
 * Images live in apps/web/public/products and are served by the storefront's CDN.
 * Run with: pnpm --filter @david-store/api db:import
 */
export interface ImportProduct {
  slug: string;
  name: string;
  brand: string;
  categorySlug: string;
  /** GH₵, converted to pesewas on import. */
  price: number;
  stock: number;
  description: string;
  keyFeatures: string[];
  inTheBox?: string[];
  specs: Record<string, unknown>;
  colour: string;
  images: { file: string; alt: string }[];
}

export const FIRST_PRODUCTS: ImportProduct[] = [
  {
    slug: 'xdobo-1983-max-120w-bluetooth-speaker',
    name: 'xdobo 1983 Max 120W Bluetooth Speaker',
    brand: 'xdobo',
    categorySlug: 'bluetooth-speakers',
    price: 2200,
    stock: 5,
    description:
      'A 120W portable Bluetooth speaker with deep, powerful bass, built in a rugged frame with a carry handle. Bluetooth 5.3 gives a fast, stable connection to your phone with low power use.',
    keyFeatures: ['120W output for big, room-filling sound', 'Bluetooth 5.3: faster connection and stronger stability', 'Rugged metal-framed body with carry handle'],
    specs: { wattage: 120, connectivity: ['Bluetooth 5.x'] },
    colour: 'Black',
    images: [
      { file: 'xdobo-1983-max-1.webp', alt: 'xdobo 1983 Max speaker, front view' },
      { file: 'xdobo-1983-max-2.webp', alt: 'xdobo 1983 Max speaker on a table' },
      { file: 'xdobo-1983-max-3.webp', alt: 'xdobo 1983 Max connected to a phone over Bluetooth 5.3' },
    ],
  },
  {
    slug: 'xdobo-karaoke-party-speaker-silver-2-wireless-mics',
    name: 'xdobo Karaoke Party Speaker with 2 Wireless Microphones, Silver',
    brand: 'xdobo',
    categorySlug: 'party-karaoke-speakers',
    price: 3200,
    stock: 5,
    description:
      'Turn any room into a karaoke stage. This xdobo party speaker comes with two wireless microphones, so two people can sing together, in a solid silver-framed cabinet.',
    keyFeatures: ['Two wireless microphones included', 'Built for karaoke and parties', 'Silver metal-framed cabinet with side carry grip'],
    inTheBox: ['Speaker', '2 wireless microphones'],
    specs: {},
    colour: 'Silver',
    images: [{ file: 'xdobo-karaoke-speaker-silver-1.webp', alt: 'xdobo silver karaoke speaker with two wireless microphones' }],
  },
  {
    slug: 'xdobo-karaoke-party-speaker-black-2-wireless-mics',
    name: 'xdobo Karaoke Party Speaker with 2 Wireless Microphones, Black',
    brand: 'xdobo',
    categorySlug: 'party-karaoke-speakers',
    price: 2900,
    stock: 5,
    description:
      'A party speaker for singing nights: two wireless microphones with their own displays, and a row of controls on top to adjust the music and the mics.',
    keyFeatures: ['Two wireless microphones with displays included', 'Control knobs on top for music and microphones', 'Built for karaoke and parties'],
    inTheBox: ['Speaker', '2 wireless microphones'],
    specs: {},
    colour: 'Black',
    images: [{ file: 'xdobo-karaoke-speaker-black-1.webp', alt: 'xdobo black karaoke speaker with two wireless microphones' }],
  },
  {
    slug: 'xdobo-live-performance-bluetooth-speaker',
    name: 'xdobo LIVE Performance Portable Bluetooth Speaker',
    brand: 'xdobo',
    categorySlug: 'bluetooth-speakers',
    price: 1250,
    stock: 5,
    description: '"LIVE Performance in Your Palm": a compact xdobo Bluetooth speaker with easy controls on top, made to take outdoors.',
    keyFeatures: ['Portable, compact design', 'Controls on top for play, volume and modes'],
    specs: {},
    colour: 'Black',
    images: [{ file: 'xdobo-live-speaker-black-1.webp', alt: 'xdobo portable Bluetooth speaker on the grass' }],
  },
  {
    slug: 'xdobo-portable-bluetooth-speaker-red',
    name: 'xdobo Portable Bluetooth Speaker, Red',
    brand: 'xdobo',
    categorySlug: 'bluetooth-speakers',
    price: 950,
    stock: 5,
    description: 'A stylish xdobo Bluetooth speaker in red fabric, with all its controls on top. Easy to carry from room to room.',
    keyFeatures: ['Red fabric finish', 'Controls on top'],
    specs: {},
    colour: 'Red',
    images: [{ file: 'xdobo-portable-speaker-red-1.webp', alt: 'xdobo red portable Bluetooth speaker' }],
  },
  {
    slug: 'xdobo-power-bank-bluetooth-speaker-12-hours',
    name: 'xdobo Bluetooth Speaker with Power Bank, 12 Hours Playback',
    brand: 'xdobo',
    categorySlug: 'bluetooth-speakers',
    price: 1100,
    stock: 5,
    description:
      'Music all day and a charged phone at the end of it. Up to 12 hours of playback from a 10,400mAh battery that also charges your phone over USB.',
    keyFeatures: ['Up to 12 hours playback', '10,400mAh battery', 'Doubles as a power bank to charge your phone'],
    specs: { batteryHours: 12, connectivity: ['USB'] },
    colour: 'Navy blue',
    images: [{ file: 'xdobo-power-bank-speaker-navy-1.webp', alt: 'xdobo speaker charging a phone, 12 hours long endurance' }],
  },
  {
    slug: 'dji-mini-4-pro-with-screen-remote',
    name: 'DJI Mini 4 Pro Drone with Screen Remote Controller',
    brand: 'DJI',
    categorySlug: 'drones',
    price: 17500,
    stock: 2,
    description:
      'DJI Mini 4 Pro, the compact drone for sharp aerial video, bundled with a remote controller that has its own built-in screen, so no phone is needed to fly.',
    keyFeatures: ['Compact, foldable drone', 'Remote controller with built-in screen'],
    inTheBox: ['DJI Mini 4 Pro drone', 'Screen remote controller'],
    specs: { type: 'Drone', videoResolution: '4K' },
    colour: 'Grey',
    images: [{ file: 'dji-mini-4-pro-1.webp', alt: 'DJI Mini 4 Pro drone with screen remote controller' }],
  },
  {
    slug: 'dji-mini-4k-drone',
    name: 'DJI Mini 4K Drone',
    brand: 'DJI',
    categorySlug: 'drones',
    price: 6200,
    stock: 3,
    description:
      'An easy first drone that films in 4K. A 3-axis gimbal keeps shots steady, video transmits up to 10 km, and it holds steady in winds up to 38 km/h.',
    keyFeatures: [
      '3-axis gimbal for stable 4K video',
      '10 km (32,800 ft) video transmission',
      '31-minute max flight time per battery (62 or 93 minutes with extra batteries)',
      '38 km/h (Level 5) wind resistance',
      'Brushless motors',
    ],
    specs: { type: 'Drone', videoResolution: '4K', flightMinutes: 31, rangeMeters: 10000, skillLevel: 'Beginner' },
    colour: 'Grey',
    images: [{ file: 'dji-mini-4k-1.webp', alt: 'DJI Mini 4K drone with 3-axis gimbal' }],
  },
];
