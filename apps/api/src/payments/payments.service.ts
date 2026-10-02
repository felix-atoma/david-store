import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, PaymentMethod, PaymentProvider, Prisma, TransactionStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { nextOrderNumber, takeStock } from '../orders/order-helpers';
import { PrismaService } from '../prisma/prisma.service';
import { HubtelService } from './hubtel.service';

const ONLINE_METHODS: PaymentMethod[] = [PaymentMethod.MOMO, PaymentMethod.CARD];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hubtel: HubtelService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Starts a Hubtel checkout for an order awaiting payment and returns the page to send the
   * customer to. Each attempt gets its own clientReference, so a retry after a failed MoMo
   * prompt doesn't collide with the first one.
   */
  async startCheckout(orderNumber: string) {
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber },
      include: { user: { select: { name: true, email: true, phone: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.paymentStatus === 'PAID') throw new BadRequestException('This order is already paid');
    if (!ONLINE_METHODS.includes(order.paymentMethod)) throw new BadRequestException('This order is not paid online');
    if (order.status !== OrderStatus.PENDING_PAYMENT) throw new BadRequestException('This order can no longer be paid');

    const amount = order.total - order.walletAmount;
    // Hubtel caps clientReference at 32 characters.
    const clientReference = `${order.number}-${randomBytes(3).toString('hex')}`.slice(0, 32);
    const storefront = this.config.getOrThrow<string>('STOREFRONT_URL');
    const api = this.config.getOrThrow<string>('API_PUBLIC_URL');

    const checkout = await this.hubtel.initiateCheckout({
      amount,
      description: `Order ${order.number}`,
      clientReference,
      callbackUrl: `${api}/api/payments/hubtel/callback`,
      returnUrl: `${storefront}/checkout/complete?ref=${clientReference}`,
      cancellationUrl: `${storefront}/checkout/complete?ref=${clientReference}&cancelled=1`,
      payeeName: order.user?.name ?? order.guestName ?? undefined,
      payeeMobileNumber: (order.user?.phone ?? order.guestPhone ?? undefined)?.replace(/^\+/, ''),
      payeeEmail: order.user?.email ?? order.guestEmail ?? undefined,
    });

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.HUBTEL,
        method: order.paymentMethod,
        amount,
        clientReference,
        checkoutId: checkout.checkoutId,
        checkoutUrl: checkout.checkoutUrl,
      },
    });
    return { checkoutUrl: checkout.checkoutUrl, clientReference };
  }

  /** Hubtel's callback. Recorded for support, then confirmed through the status check before anything changes. */
  async handleCallback(body: unknown) {
    const data = (body as { Data?: { ClientReference?: string } })?.Data;
    const reference = data?.ClientReference;
    if (!reference) return;

    const payment = await this.prisma.payment.findUnique({ where: { clientReference: reference } });
    if (!payment) {
      this.logger.warn(`Hubtel callback for unknown reference ${reference}`);
      return;
    }
    await this.prisma.payment.update({ where: { id: payment.id }, data: { rawCallback: body as Prisma.InputJsonValue } });
    await this.verify(reference);
  }

  /**
   * Asks Hubtel whether the payment went through and settles the order once. Called from the
   * callback and from the storefront's return page, so it must be safe to run more than once.
   */
  async verify(clientReference: string) {
    const payment = await this.prisma.payment.findUnique({ where: { clientReference }, include: { order: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== TransactionStatus.PENDING) return this.summary(payment.status, payment.order.number);

    const result = await this.hubtel.checkStatus(clientReference);
    if (result.status !== 'Paid') return this.summary(payment.status, payment.order.number);

    const paidPesewas = Math.round(result.amount * 100);
    if (paidPesewas < payment.amount) {
      this.logger.error(`Underpayment on ${clientReference}: expected ${payment.amount}, Hubtel reports ${paidPesewas}`);
      return this.summary(payment.status, payment.order.number);
    }

    await this.prisma.$transaction(async (tx) => {
      // The status filter makes this a no-op if a parallel call already settled it.
      const settled = await tx.payment.updateMany({
        where: { id: payment.id, status: TransactionStatus.PENDING },
        data: {
          status: TransactionStatus.SUCCESS,
          providerReference: result.transactionId,
          channel: result.paymentMethod,
          verifiedAt: new Date(),
        },
      });
      if (!settled.count) return;
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: 'PAID', status: OrderStatus.PLACED },
      });
      await tx.orderStatusEvent.create({
        data: { orderId: payment.orderId, status: OrderStatus.PLACED, note: `Paid by ${result.paymentMethod ?? 'Hubtel'}` },
      });
      // Online orders take stock only once paid, so abandoned checkouts never hold it.
      await takeStock(tx, payment.orderId);
    });
    return this.summary(TransactionStatus.SUCCESS, payment.order.number);
  }

  /**
   * A real GH₵ payment through Hubtel with no products attached, so David can watch a payment
   * go through end to end. The order is flagged isTest and left out of reports.
   */
  async startTestPayment(amount: number, actor: { sub: string; name: string; email: string | null }) {
    const order = await this.prisma.order.create({
      data: {
        number: await nextOrderNumber(this.prisma),
        userId: actor.sub,
        status: OrderStatus.PENDING_PAYMENT,
        paymentMethod: PaymentMethod.MOMO,
        deliveryMethod: 'PICKUP',
        subtotal: amount,
        deliveryFee: 0,
        total: amount,
        isTest: true,
        customerNote: 'Hubtel test payment from the admin settings page',
        events: { create: { status: OrderStatus.PENDING_PAYMENT, note: 'Test payment started', actorId: actor.sub } },
      },
    });
    return { orderNumber: order.number, ...(await this.startCheckout(order.number)) };
  }

  async onlineAvailable() {
    return this.hubtel.configured();
  }

  private summary(status: TransactionStatus, orderNumber: string) {
    return { status, orderNumber };
  }
}
