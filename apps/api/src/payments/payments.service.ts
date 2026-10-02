import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Order, OrderStatus, PaymentMethod, PaymentProvider, Prisma, TransactionStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { SettingsService } from '../common/settings.service';
import { nextOrderNumber, takeStock } from '../orders/order-helpers';
import { PrismaService } from '../prisma/prisma.service';
import { HubtelService } from './hubtel.service';
import { PaystackService } from './paystack.service';

const ONLINE_METHODS: PaymentMethod[] = [PaymentMethod.MOMO, PaymentMethod.CARD];

type OrderWithUser = Order & { user: { name: string; email: string | null; phone: string | null } | null };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hubtel: HubtelService,
    private readonly paystack: PaystackService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Starts an online payment for an order awaiting payment, through whichever gateway is active,
   * and returns the page to send the customer to. Each attempt gets its own reference, so a retry
   * after a failed MoMo prompt doesn't collide with the first one.
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

    const provider = await this.settings.activeProvider();
    if (!provider) throw new ServiceUnavailableException('Online payments are not set up yet');

    const amount = order.total - order.walletAmount;
    // Hubtel caps references at 32 characters; Paystack accepts the same format.
    const reference = `${order.number}-${randomBytes(3).toString('hex')}`.slice(0, 32);
    const returnUrl = `${this.config.getOrThrow<string>('STOREFRONT_URL')}/checkout/complete?ref=${reference}`;

    const started = provider === 'PAYSTACK' ? await this.startPaystack(order, amount, reference, returnUrl) : await this.startHubtel(order, amount, reference, returnUrl);

    await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider === 'PAYSTACK' ? PaymentProvider.PAYSTACK : PaymentProvider.HUBTEL,
        method: order.paymentMethod,
        amount,
        clientReference: reference,
        checkoutId: started.checkoutId,
        checkoutUrl: started.checkoutUrl,
        customerPhone: order.user?.phone ?? order.guestPhone,
      },
    });
    return { checkoutUrl: started.checkoutUrl, clientReference: reference };
  }

  private async startHubtel(order: OrderWithUser, amount: number, reference: string, returnUrl: string) {
    const api = this.config.getOrThrow<string>('API_PUBLIC_URL');
    const checkout = await this.hubtel.initiateCheckout({
      amount,
      description: `Order ${order.number}`,
      clientReference: reference,
      callbackUrl: `${api}/api/payments/hubtel/callback`,
      returnUrl,
      cancellationUrl: `${returnUrl}&cancelled=1`,
      payeeName: order.user?.name ?? order.guestName ?? undefined,
      payeeMobileNumber: (order.user?.phone ?? order.guestPhone ?? undefined)?.replace(/^\+/, ''),
      payeeEmail: order.user?.email ?? order.guestEmail ?? undefined,
    });
    return { checkoutId: checkout.checkoutId, checkoutUrl: checkout.checkoutUrl };
  }

  private async startPaystack(order: OrderWithUser, amount: number, reference: string, returnUrl: string) {
    // Paystack needs an email for its receipt. Checkout asks for one with online payment;
    // older orders without one get a placeholder Paystack accepts but never delivers to.
    const phoneDigits = (order.user?.phone ?? order.guestPhone ?? '').replace(/\D/g, '') || order.number.toLowerCase();
    const email = order.user?.email ?? order.guestEmail ?? `${phoneDigits}@customers.davo.invalid`;
    const checkout = await this.paystack.initialize({
      amount,
      email,
      reference,
      callbackUrl: returnUrl,
      metadata: { orderNumber: order.number, phone: order.user?.phone ?? order.guestPhone, isTest: order.isTest },
    });
    return { checkoutId: checkout.accessCode, checkoutUrl: checkout.checkoutUrl };
  }

  /** Hubtel's callback. Recorded for support, then confirmed through the status check before anything changes. */
  async handleHubtelCallback(body: unknown) {
    const reference = (body as { Data?: { ClientReference?: string } })?.Data?.ClientReference;
    if (!reference) return;
    const payment = await this.prisma.payment.findUnique({ where: { clientReference: reference } });
    if (!payment) {
      this.logger.warn(`Hubtel callback for unknown reference ${reference}`);
      return;
    }
    await this.prisma.payment.update({ where: { id: payment.id }, data: { rawCallback: body as Prisma.InputJsonValue } });
    await this.verify(reference);
  }

  /** Paystack's webhook: rejected unless signed with our secret key, then re-verified with Paystack. */
  async handlePaystackWebhook(rawBody: Buffer | undefined, signature: string | undefined, body: unknown) {
    if (!(await this.paystack.validSignature(rawBody, signature))) throw new UnauthorizedException('Bad signature');
    const event = body as { event?: string; data?: { reference?: string } };
    const reference = event.data?.reference;
    if (event.event !== 'charge.success' || !reference) return;
    const payment = await this.prisma.payment.findUnique({ where: { clientReference: reference } });
    if (!payment) {
      this.logger.warn(`Paystack webhook for unknown reference ${reference}`);
      return;
    }
    await this.prisma.payment.update({ where: { id: payment.id }, data: { rawCallback: body as Prisma.InputJsonValue } });
    await this.verify(reference);
  }

  /**
   * Asks the gateway whether the payment went through and settles the order once. Called from
   * callbacks and from the storefront's return page, so it must be safe to run more than once.
   */
  async verify(reference: string) {
    const payment = await this.prisma.payment.findUnique({ where: { clientReference: reference }, include: { order: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== TransactionStatus.PENDING) return this.summary(payment.status, payment.order.number);

    let paid: { amount: number; providerReference?: string; channel?: string } | null = null;
    if (payment.provider === PaymentProvider.PAYSTACK) {
      const tx = await this.paystack.verify(reference);
      if (tx.status === 'failed') {
        await this.prisma.payment.updateMany({ where: { id: payment.id, status: TransactionStatus.PENDING }, data: { status: TransactionStatus.FAILED } });
        return this.summary(TransactionStatus.FAILED, payment.order.number);
      }
      if (tx.status === 'success' && tx.currency === 'GHS') paid = { amount: tx.amount, providerReference: tx.id ? String(tx.id) : undefined, channel: tx.channel };
    } else {
      const result = await this.hubtel.checkStatus(reference);
      if (result.status === 'Paid') paid = { amount: Math.round(result.amount * 100), providerReference: result.transactionId, channel: result.paymentMethod };
    }
    if (!paid) return this.summary(payment.status, payment.order.number);

    if (paid.amount < payment.amount) {
      this.logger.error(`Underpayment on ${reference}: expected ${payment.amount}, gateway reports ${paid.amount}`);
      return this.summary(payment.status, payment.order.number);
    }

    await this.prisma.$transaction(async (tx) => {
      // The status filter makes this a no-op if a parallel call already settled it.
      const settled = await tx.payment.updateMany({
        where: { id: payment.id, status: TransactionStatus.PENDING },
        data: { status: TransactionStatus.SUCCESS, providerReference: paid.providerReference, channel: paid.channel, verifiedAt: new Date() },
      });
      if (!settled.count) return;
      await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'PAID', status: OrderStatus.PLACED } });
      const via = paid.channel === 'mobile_money' ? 'Mobile Money' : paid.channel === 'card' ? 'card' : paid.channel ?? payment.provider;
      await tx.orderStatusEvent.create({ data: { orderId: payment.orderId, status: OrderStatus.PLACED, note: `Paid by ${via} via ${payment.provider === 'PAYSTACK' ? 'Paystack' : 'Hubtel'}` } });
      // Online orders take stock only once paid, so abandoned checkouts never hold it.
      await takeStock(tx, payment.orderId);
    });
    return this.summary(TransactionStatus.SUCCESS, payment.order.number);
  }

  /**
   * A small real payment (or a pretend one with Paystack test keys) with no products attached,
   * so the owner can watch a payment go through end to end. Flagged isTest; left out of reports.
   */
  async startTestPayment(amount: number, actor: { sub: string; name: string; email: string | null }) {
    const order = await this.prisma.order.create({
      data: {
        number: await nextOrderNumber(this.prisma),
        userId: actor.sub,
        guestEmail: actor.email,
        status: OrderStatus.PENDING_PAYMENT,
        paymentMethod: PaymentMethod.MOMO,
        deliveryMethod: 'PICKUP',
        subtotal: amount,
        deliveryFee: 0,
        total: amount,
        isTest: true,
        customerNote: 'Test payment from the admin settings page',
        events: { create: { status: OrderStatus.PENDING_PAYMENT, note: 'Test payment started', actorId: actor.sub } },
      },
    });
    return { orderNumber: order.number, ...(await this.startCheckout(order.number)) };
  }

  async onlineAvailable() {
    return Boolean(await this.settings.activeProvider());
  }

  private summary(status: TransactionStatus, orderNumber: string) {
    return { status, orderNumber };
  }
}
