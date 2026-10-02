import { formatGhs } from './money';

/**
 * Search titles and descriptions, written for how people in Ghana search ("… price in Ghana",
 * "buy … online in Ghana"). A custom seoTitle / seoDescription saved on a product or category
 * always wins over these.
 */
export const STORE_NAME = 'Davo';

/** Added after the main text, longest first, only if it fits whole. */
const TAILS = ['Delivery across Ghana; pay with MoMo, card or cash on delivery.', 'Delivery across Ghana; MoMo, card or pay on delivery.', 'Fast delivery across Ghana.'];

const withTail = (main: string, max = 155) => {
  const base = main.replace(/\s+/g, ' ').trim();
  const tail = TAILS.find((t) => base.length + 1 + t.length <= max);
  return tail ? `${base} ${tail}` : clip(base, max);
};

/** GH₵6,200 rather than GH₵6,200.00 when there are no pesewas. */
const price = (pesewas: number) => formatGhs(pesewas).replace(/\.00$/, '');

/** Google shows about 155 characters of a description; cut at a word boundary. */
export const clip = (text: string, max = 155) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.;:\s]+$/, '')}…`;
};

const firstSentence = (text: string) => text.replace(/\s+/g, ' ').trim().match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text.trim();

/** "DJI Mini 4K Drone: Price in Ghana | Davo" */
export const productSeoTitle = (p: { name: string; seoTitle?: string | null }) => p.seoTitle || `${p.name}: Price in Ghana | ${STORE_NAME}`;

/** "Buy DJI Mini 4K Drone in Ghana for GH₵6,200 at Davo. An easy first drone that films in 4K. Delivery across Ghana…" */
export const productSeoDescription = (p: { name: string; price: number; description: string; seoDescription?: string | null }) =>
  p.seoDescription || withTail(`Buy ${p.name} in Ghana for ${price(p.price)} at ${STORE_NAME}. ${firstSentence(p.description)}`);

/** "Smartphones: Buy Online in Ghana | Davo" */
export const categorySeoTitle = (c: { name: string; seoTitle?: string | null }) => c.seoTitle || `${c.name}: Buy Online in Ghana | ${STORE_NAME}`;

/**
 * Uses the category's own description when it has one; otherwise lists what it holds
 * (sub-categories or brands), which is what people type into search.
 */
export const categorySeoDescription = (c: { name: string; description?: string | null; seoDescription?: string | null; children?: string[]; brands?: string[] }) => {
  if (c.seoDescription) return c.seoDescription;
  if (c.description) return withTail(`${firstSentence(c.description)} Shop ${c.name.toLowerCase()} online in Ghana at ${STORE_NAME}.`);
  const list = c.children?.length ? c.children.slice(0, 5).map((n) => n.toLowerCase()) : (c.brands ?? []).slice(0, 5);
  const holds = list.length ? `: ${list.join(', ')} and more` : '';
  return withTail(`Shop ${c.name.toLowerCase()} online in Ghana at ${STORE_NAME}${holds}. Genuine products, best prices.`);
};

export const HOME_SEO_TITLE = `${STORE_NAME} | Shop Online in Ghana: Phones, Electronics, Speakers & More`;
export const HOME_SEO_DESCRIPTION =
  'Shop online in Ghana at Davo: phones, laptops, speakers, drones, fashion and home goods. Delivery across Ghana; pay with MoMo, card or on delivery.';
