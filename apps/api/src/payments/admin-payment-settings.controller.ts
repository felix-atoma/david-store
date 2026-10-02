import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../auth/jwt-auth.guard';
import { ActivityLogService } from '../common/activity-log.service';
import { SecretBoxService } from '../common/secret-box.service';
import { OnlineProvider, SettingsService } from '../common/settings.service';
import { HubtelService } from './hubtel.service';
import { PaymentsService } from './payments.service';
import { PaystackService } from './paystack.service';

class SaveHubtelDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  apiId: string;

  /** Leave out to keep the saved key and change only the other fields. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  apiKey?: string;

  @Matches(/^\d{4,12}$/, { message: 'POS Sales ID is the number Hubtel gives the merchant account, e.g. 2017101' })
  merchantAccount: string;
}

class SavePaystackDto {
  @Matches(/^pk_(test|live)_[A-Za-z0-9]{10,}$/, { message: 'Public key starts with pk_test_ or pk_live_' })
  publicKey: string;

  /** Leave out to keep the saved key. */
  @IsOptional()
  @Matches(/^sk_(test|live)_[A-Za-z0-9]{10,}$/, { message: 'Secret key starts with sk_test_ or sk_live_' })
  secretKey?: string;
}

class ProviderDto {
  @IsIn(['PAYSTACK', 'HUBTEL'])
  provider: OnlineProvider;
}

class TestPaymentDto {
  /** Pesewas; GH₵1 by default, at most GH₵10. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1000)
  amount = 100;
}

const mask = (value: string) => (value.length <= 4 ? '••••' : `••••${value.slice(-4)}`);

/** Payment settings are for the super admin only; staff never see or change them. */
@Controller('admin/settings/payments')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminPaymentSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly box: SecretBoxService,
    private readonly hubtel: HubtelService,
    private readonly paystack: PaystackService,
    private readonly payments: PaymentsService,
    private readonly activity: ActivityLogService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async status() {
    const [creds, paystack, active, preferred] = await Promise.all([this.settings.hubtel(), this.settings.paystack(), this.settings.activeProvider(), this.settings.preferredProvider()]);
    const api = this.config.get<string>('API_PUBLIC_URL') ?? '';
    const storefront = this.config.get<string>('STOREFRONT_URL') ?? '';
    return {
      hubtel: creds
        ? { connected: true, source: creds.source, apiId: creds.apiId, apiKey: mask(creds.apiKey), merchantAccount: creds.merchantAccount }
        : { connected: false },
      paystack: paystack
        ? { connected: true, source: paystack.source, publicKey: paystack.publicKey, secretKey: mask(paystack.secretKey), mode: paystack.secretKey.startsWith('sk_live_') ? 'live' : 'test' }
        : { connected: false },
      /** The gateway customers pay through right now; null means pay on delivery only. */
      activeProvider: active,
      preferredProvider: preferred,
      paystackWebhookUrl: `${api}/api/payments/paystack/webhook`,
      canSaveKeys: this.box.available,
      // What David gives Hubtel when setting up the merchant account.
      callbackUrl: `${api}/api/payments/hubtel/callback`,
      returnUrl: `${storefront}/checkout/complete`,
    };
  }

  @Put('hubtel')
  async save(@Body() dto: SaveHubtelDto, @CurrentUser() user: AuthUser) {
    await this.settings.saveHubtel({ apiId: dto.apiId.trim(), apiKey: dto.apiKey?.trim(), merchantAccount: dto.merchantAccount }, user.email ?? undefined);
    // The key itself is never written to the activity log.
    await this.activity.record({
      actorId: user.sub,
      action: 'settings.hubtel.save',
      entityType: 'StoreSetting',
      entityId: 'payments.hubtel',
      after: { apiId: dto.apiId, merchantAccount: dto.merchantAccount, apiKeyChanged: Boolean(dto.apiKey) },
    });
    return this.status();
  }

  @Delete('hubtel')
  @HttpCode(204)
  async clear(@CurrentUser() user: AuthUser) {
    await this.settings.clearHubtel();
    await this.activity.record({ actorId: user.sub, action: 'settings.hubtel.clear', entityType: 'StoreSetting', entityId: 'payments.hubtel' });
  }

  @Put('paystack')
  async savePaystack(@Body() dto: SavePaystackDto, @CurrentUser() user: AuthUser) {
    await this.settings.savePaystack({ publicKey: dto.publicKey.trim(), secretKey: dto.secretKey?.trim() }, user.email ?? undefined);
    await this.activity.record({
      actorId: user.sub,
      action: 'settings.paystack.save',
      entityType: 'StoreSetting',
      entityId: 'payments.paystack',
      after: { publicKey: dto.publicKey, secretKeyChanged: Boolean(dto.secretKey) },
    });
    return this.status();
  }

  @Delete('paystack')
  @HttpCode(204)
  async clearPaystack(@CurrentUser() user: AuthUser) {
    await this.settings.clearPaystack();
    await this.activity.record({ actorId: user.sub, action: 'settings.paystack.clear', entityType: 'StoreSetting', entityId: 'payments.paystack' });
  }

  @Post('paystack/test')
  @HttpCode(200)
  testPaystack() {
    return this.paystack.testConnection();
  }

  /** When both gateways have keys, which one customers pay through. */
  @Put('provider')
  async setProvider(@Body() dto: ProviderDto, @CurrentUser() user: AuthUser) {
    await this.settings.setPreferredProvider(dto.provider);
    await this.activity.record({ actorId: user.sub, action: 'settings.payments.provider', entityType: 'StoreSetting', entityId: 'payments.provider', after: dto });
    return this.status();
  }

  @Post('hubtel/test')
  @HttpCode(200)
  test() {
    return this.hubtel.testConnection();
  }

  /** Starts a real payment (GH₵1 by default) and returns Hubtel's checkout page. */
  @Post('test-payment')
  @HttpCode(200)
  async testPayment(@Body() dto: TestPaymentDto, @CurrentUser() user: AuthUser) {
    const result = await this.payments.startTestPayment(dto.amount, user);
    await this.activity.record({ actorId: user.sub, action: 'settings.hubtel.testPayment', entityType: 'Order', entityId: result.orderNumber, after: { amount: dto.amount } });
    return result;
  }
}
