import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CreateOrderDto } from './orders.dto';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('checkout/options')
  options() {
    return this.orders.checkoutOptions();
  }

  /** The item a Buy now link points at, with its live price and stock. */
  @Get('checkout/variant/:id')
  variant(@Param('id') id: string) {
    return this.orders.checkoutItem(id);
  }

  /** Guest checkout. Signed-in checkout and the cart arrive with customer accounts. */
  @Post('orders')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Get('orders/:number')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  summary(@Param('number') number: string, @Query('phone') phone?: string) {
    return this.orders.publicSummary(number, phone);
  }
}
