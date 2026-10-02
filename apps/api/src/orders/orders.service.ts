import { formatGhs } from '@david-store/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DeliveryMethod, OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import { visibleProduct } from '../catalog/products.service';
import { SettingsService } from '../common/settings.service';
import { HubtelService } from '../payments/hubtel.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './orders.dto';
import { nextOrderNumber, takeStock } from './order-helpers';

const DAY_MS = 86_400_000;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly hubtel: HubtelService,
  ) {}

  /** Everything the checkout page needs to show delivery choices, fees and payment options. */
  async checkoutOptions() {
    const [zones, stations, freeThreshold, podMax, online] = await Promise.all([
      this.prisma.deliveryZone.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, areas: true, fee: true, minDays: true, maxDays: true },
      }),
      this.prisma.pickupStation.findMany({
        where: { isActive: true, zone: { isActive: true } },
        select: { id: true, name: true, address: true, openingHours: true, fee: true, zone: { select: { minDays: true, maxDays: true } } },
      }),
      this.settings.get<number>('delivery.freeThreshold', 0),
      this.settings.get<number>('payments.podMaxOrder', 0),
      this.hubtel.configured(),
    ]);
    return { zones, pickupStations: stations, freeDeliveryThreshold: freeThreshold, payOnDeliveryMax: podMax, onlinePayments: online };
  }

  async checkoutItem(variantId: string) {
    const v = await this.prisma.productVariant.findFirst({
      where: { id: variantId, isActive: true, product: visibleProduct() },
      include: { product: { select: { name: true, freeDelivery: true, images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } } } } },
    });
    if (!v) throw new NotFoundException('This item is no longer available');
    return {
      variantId: v.id,
      name: v.product.name,
      variantName: v.name,
      price: v.price,
      stock: v.stock,
      image: v.product.images[0]?.url ?? null,
      freeDelivery: v.product.freeDelivery,
    };
  }

  async create(dto: CreateOrderDto) {
    const online = dto.paymentMethod !== PaymentMethod.PAY_ON_DELIVERY;
    if (online && !(await this.hubtel.configured())) {
      throw new ServiceUnavailableException('MoMo and card payments are not switched on yet. Choose pay on delivery.');
    }

    // Merge repeated variants, then load what is actually on sale.
    const wanted = new Map<string, number>();
    for (const item of dto.items) wanted.set(item.variantId, (wanted.get(item.variantId) ?? 0) + item.quantity);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: [...wanted.keys()] }, isActive: true, product: visibleProduct() },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            vendorId: true,
            freeDelivery: true,
            images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
            category: { select: { commissionBps: true } },
          },
        },
      },
    });
    if (variants.length !== wanted.size) throw new BadRequestException('Some items are no longer available. Please refresh and try again.');
    for (const v of variants) {
      const qty = wanted.get(v.id)!;
      if (v.stock < qty) throw new ConflictException(`Only ${Math.max(v.stock, 0)} of "${v.product.name}" left in stock.`);
    }

    const lines = variants.map((v) => {
      const quantity = wanted.get(v.id)!;
      const lineTotal = v.price * quantity;
      const commissionBps = v.product.category.commissionBps ?? 0;
      return { v, quantity, lineTotal, commissionBps, commission: Math.round((lineTotal * commissionBps) / 10_000) };
    });
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

    const { fee, zoneId, minDays, maxDays, address } = await this.delivery(dto);
    const freeThreshold = await this.settings.get<number>('delivery.freeThreshold', 0);
    const freeDelivery = (freeThreshold > 0 && subtotal >= freeThreshold) || lines.every((l) => l.v.product.freeDelivery);
    const deliveryFee = freeDelivery ? 0 : fee;
    const total = subtotal + deliveryFee;

    if (!online) {
      const podMax = await this.settings.get<number>('payments.podMaxOrder', 0);
      if (podMax > 0 && total > podMax) {
        throw new BadRequestException(`Pay on delivery is available for orders up to ${formatGhs(podMax)}. Please pay by MoMo or card.`);
      }
    }

    const now = Date.now();
    const status = online ? OrderStatus.PENDING_PAYMENT : OrderStatus.PLACED;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          number: await nextOrderNumber(tx),
          guestName: dto.name.trim(),
          guestPhone: dto.phone,
          guestEmail: dto.email?.toLowerCase(),
          status,
          paymentMethod: dto.paymentMethod,
          deliveryMethod: dto.deliveryMethod,
          shippingAddress: address as Prisma.InputJsonValue | undefined,
          deliveryZoneId: zoneId,
          pickupStationId: dto.deliveryMethod === DeliveryMethod.PICKUP ? dto.pickupStationId : undefined,
          subtotal,
          deliveryFee,
          total,
          customerNote: dto.note,
          estimatedFrom: new Date(now + minDays * DAY_MS),
          estimatedTo: new Date(now + maxDays * DAY_MS),
          events: { create: { status, note: online ? 'Waiting for payment' : 'Pay on delivery' } },
        },
      });

      // One package per vendor: with only the house vendor today, every order has one.
      const byVendor = new Map<string, typeof lines>();
      for (const l of lines) byVendor.set(l.v.product.vendorId, [...(byVendor.get(l.v.product.vendorId) ?? []), l]);
      for (const [vendorId, vendorLines] of byVendor) {
        const itemsTotal = vendorLines.reduce((s, l) => s + l.lineTotal, 0);
        const commission = vendorLines.reduce((s, l) => s + l.commission, 0);
        const pkg = await tx.orderPackage.create({
          data: {
            orderId: order.id,
            vendorId,
            itemsTotal,
            commission,
            vendorEarning: itemsTotal - commission,
            // The rider collects the whole order total on the single package; split per package once vendors exist.
            codAmount: online ? 0 : byVendor.size === 1 ? total : itemsTotal,
          },
        });
        await tx.orderItem.createMany({
          data: vendorLines.map((l) => ({
            orderId: order.id,
            packageId: pkg.id,
            vendorId,
            productId: l.v.product.id,
            variantId: l.v.id,
            productName: l.v.product.name,
            variantName: l.v.name,
            sku: l.v.sku,
            imageUrl: l.v.product.images[0]?.url,
            unitPrice: l.v.price,
            quantity: l.quantity,
            lineTotal: l.lineTotal,
            commissionBps: l.commissionBps,
            commission: l.commission,
          })),
        });
      }

      if (!online) await takeStock(tx, order.id);
      return { number: order.number, status: order.status, paymentMethod: order.paymentMethod, total };
    });
  }

  /** Order status for the customer. The phone number must match, so order numbers alone reveal nothing. */
  async publicSummary(number: string, phone: string | undefined) {
    const order = await this.prisma.order.findUnique({
      where: { number },
      include: {
        items: { select: { productName: true, variantName: true, quantity: true, lineTotal: true, imageUrl: true } },
        events: { orderBy: { createdAt: 'asc' }, select: { status: true, note: true, createdAt: true } },
        deliveryZone: { select: { name: true } },
        pickupStation: { select: { name: true, address: true } },
        user: { select: { phone: true } },
      },
    });
    const owner = order?.guestPhone ?? order?.user?.phone;
    if (!order || !phone || owner !== phone) throw new NotFoundException('Order not found. Check the order number and phone number.');

    const { user: _user, guestEmail: _email, shippingAddress: _address, ...rest } = order;
    return rest;
  }

  private async delivery(dto: CreateOrderDto) {
    if (dto.deliveryMethod === DeliveryMethod.PICKUP) {
      const station = await this.prisma.pickupStation.findFirst({
        where: { id: dto.pickupStationId, isActive: true },
        include: { zone: true },
      });
      if (!station) throw new BadRequestException('Choose a pickup station');
      return { fee: station.fee, zoneId: station.zoneId, minDays: station.zone.minDays, maxDays: station.zone.maxDays, address: undefined };
    }
    const zone = await this.prisma.deliveryZone.findFirst({ where: { id: dto.zoneId, isActive: true } });
    if (!zone) throw new BadRequestException('Choose a delivery area');
    return { fee: zone.fee, zoneId: zone.id, minDays: zone.minDays, maxDays: zone.maxDays, address: { ...dto.address, fullName: dto.name, phone: dto.phone } };
  }
}
