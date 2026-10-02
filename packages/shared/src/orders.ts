export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PLACED',
  'CONFIRMED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The five steps shown on the tracking page, in order. */
export const TRACKING_STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'PLACED', label: 'Order placed' },
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'SHIPPED', label: 'Shipped' },
  { status: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { status: 'DELIVERED', label: 'Delivered' },
];

/** Customers can cancel until the order ships. */
export const CANCELLABLE_STATUSES: OrderStatus[] = ['PENDING_PAYMENT', 'PLACED', 'CONFIRMED'];

export const PAYMENT_METHODS = ['MOMO', 'CARD', 'PAY_ON_DELIVERY', 'WALLET'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  MOMO: 'Mobile Money (MTN, Telecel, AirtelTigo)',
  CARD: 'Visa or Mastercard',
  PAY_ON_DELIVERY: 'Pay on delivery',
  WALLET: 'Store wallet',
};
