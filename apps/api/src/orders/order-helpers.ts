import { Prisma, PrismaClient, StockReason } from '@prisma/client';
import { randomInt } from 'crypto';

type Db = PrismaClient | Prisma.TransactionClient;

// No 0/O or 1/I, so numbers read cleanly over the phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Customer-facing order number, e.g. DV26-7K3M9Q (DV for Davo). Short enough for SMS and Hubtel's 32-character reference. */
export async function nextOrderNumber(db: Db) {
  const year = new Date().getFullYear().toString().slice(2);
  for (;;) {
    const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    const number = `DV${year}-${code}`;
    if (!(await db.order.findUnique({ where: { number }, select: { id: true } }))) return number;
  }
}

/**
 * Takes an order's items out of stock and records each movement. Called once per order:
 * when a pay-on-delivery order is placed, or when an online payment settles.
 */
export async function takeStock(tx: Prisma.TransactionClient, orderId: string, actorId?: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { variantId: true, productId: true, quantity: true } });
  for (const item of items) {
    const variant = await tx.productVariant.update({
      where: { id: item.variantId },
      data: { stock: { decrement: item.quantity } },
      select: { stock: true },
    });
    await tx.stockMovement.create({
      data: { variantId: item.variantId, change: -item.quantity, stockAfter: variant.stock, reason: StockReason.SALE, orderId, actorId },
    });
    await tx.product.update({ where: { id: item.productId }, data: { soldCount: { increment: item.quantity } } });
  }
}
