/** All amounts travel as integer pesewas (GH₵ 1.00 = 100). */
export const toPesewas = (cedis: number) => Math.round(cedis * 100);

export const toCedis = (pesewas: number) => pesewas / 100;

const formatter = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', minimumFractionDigits: 2 });

/** 125000 → "GH₵1,250.00" */
export const formatGhs = (pesewas: number) => formatter.format(pesewas / 100).replace('GHS', 'GH₵');

/** Whole-number discount for the "% off" badge, or null when there is none. */
export const discountPercent = (price: number, oldPrice?: number | null) =>
  oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : null;
