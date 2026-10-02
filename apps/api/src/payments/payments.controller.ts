import { Body, Controller, Headers, HttpCode, Logger, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly payments: PaymentsService) {}

  @Post('orders/:number/checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  checkout(@Param('number') number: string) {
    return this.payments.startCheckout(number);
  }

  /** Polled by the storefront's return page until the payment settles. */
  @Post(':reference/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Param('reference') reference: string) {
    return this.payments.verify(reference);
  }

  /** Always answers 200 so Hubtel doesn't retry forever; failures are logged and the return page re-checks. */
  @Post('hubtel/callback')
  @HttpCode(200)
  @SkipThrottle()
  async hubtelCallback(@Body() body: unknown) {
    try {
      await this.payments.handleHubtelCallback(body);
    } catch (err) {
      this.logger.error('Hubtel callback handling failed', err as Error);
    }
    return { received: true };
  }

  /** Unsigned or forged calls get 401; anything else answers 200 so Paystack stops retrying. */
  @Post('paystack/webhook')
  @HttpCode(200)
  @SkipThrottle()
  async paystackWebhook(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') signature: string | undefined, @Body() body: unknown) {
    try {
      await this.payments.handlePaystackWebhook(req.rawBody, signature, body);
    } catch (err) {
      if ((err as { status?: number }).status === 401) throw err;
      this.logger.error('Paystack webhook handling failed', err as Error);
    }
    return { received: true };
  }
}
