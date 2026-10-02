import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecretBoxService } from './secret-box.service';

export interface HubtelCredentials {
  apiId: string;
  apiKey: string;
  merchantAccount: string;
  source: 'dashboard' | 'environment';
}

/** Hubtel keys saved from the dashboard. apiKey is stored sealed, never in plain text. */
interface StoredHubtel {
  apiId: string;
  apiKeySealed: string;
  merchantAccount: string;
  updatedBy?: string;
}

const HUBTEL_KEY = 'payments.hubtel';
const CACHE_MS = 60_000;

@Injectable()
export class SettingsService {
  private hubtelCache: { value: HubtelCredentials | null; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly box: SecretBoxService,
    private readonly config: ConfigService,
  ) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.storeSetting.findUnique({ where: { key } });
    return row ? (row.value as T) : fallback;
  }

  async set(key: string, value: unknown) {
    await this.prisma.storeSetting.upsert({
      where: { key },
      update: { value: value as Prisma.InputJsonValue },
      create: { key, value: value as Prisma.InputJsonValue },
    });
  }

  /** Keys saved in the dashboard win; environment variables are the fallback. */
  async hubtel(): Promise<HubtelCredentials | null> {
    if (this.hubtelCache && Date.now() - this.hubtelCache.at < CACHE_MS) return this.hubtelCache.value;

    let value: HubtelCredentials | null = null;
    const stored = await this.get<StoredHubtel | null>(HUBTEL_KEY, null);
    if (stored && this.box.available) {
      value = { apiId: stored.apiId, apiKey: this.box.open(stored.apiKeySealed), merchantAccount: stored.merchantAccount, source: 'dashboard' };
    } else {
      const [apiId, apiKey, merchantAccount] = ['HUBTEL_API_ID', 'HUBTEL_API_KEY', 'HUBTEL_MERCHANT_ACCOUNT'].map((k) => this.config.get<string>(k));
      if (apiId && apiKey && merchantAccount) value = { apiId, apiKey, merchantAccount, source: 'environment' };
    }
    this.hubtelCache = { value, at: Date.now() };
    return value;
  }

  async saveHubtel(input: { apiId: string; apiKey?: string; merchantAccount: string }, actorEmail?: string) {
    const existing = await this.get<StoredHubtel | null>(HUBTEL_KEY, null);
    const apiKeySealed = input.apiKey ? this.box.seal(input.apiKey) : existing?.apiKeySealed;
    if (!apiKeySealed) throw new Error('API key is required the first time');
    await this.set(HUBTEL_KEY, { apiId: input.apiId, apiKeySealed, merchantAccount: input.merchantAccount, updatedBy: actorEmail } satisfies StoredHubtel);
    this.hubtelCache = null;
  }

  async clearHubtel() {
    await this.prisma.storeSetting.deleteMany({ where: { key: HUBTEL_KEY } });
    this.hubtelCache = null;
  }
}
