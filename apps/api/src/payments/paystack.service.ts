import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PaystackCredentials, SettingsService } from '../common/settings.service';
import { CheckResult } from './hubtel.service';

/**
 * Paystack (Ghana): one hosted page for MTN, Telecel and AirtelTigo MoMo plus Visa/Mastercard.
 * Test keys (sk_test_…) take test payments with no business documents; live keys (sk_live_…)
 * work once Paystack has verified the business. Amounts are in pesewas, as we store them.
 * https://paystack.com/docs/api/transaction/
 */
const API = 'https://api.paystack.co';

interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data?: T;
}

export interface PaystackTransaction {
  /** "success", "failed", "abandoned", "ongoing", "pending", "processing", "queued", "reversed". */
  status: string;
  reference: string;
  amount: number;
  currency: string;
  channel?: string;
  id?: number;
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  constructor(private readonly settings: SettingsService) {}

  async initialize(req: { amount: number; email: string; reference: string; callbackUrl: string; metadata: Record<string, unknown> }) {
    const creds = await this.credentials();
    const { json } = await this.call<{ authorization_url: string; access_code: string; reference: string }>(creds, '/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        amount: req.amount,
        email: req.email,
        currency: 'GHS',
        reference: req.reference,
        callback_url: req.callbackUrl,
        channels: ['mobile_money', 'card'],
        metadata: req.metadata,
      }),
    });
    if (!json?.status || !json.data?.authorization_url) {
      this.logger.error(`Paystack initialize failed for ${req.reference}: ${json?.message ?? 'no response'}`);
      throw new BadGatewayException('Could not start the payment. Please try again.');
    }
    return { checkoutUrl: json.data.authorization_url, accessCode: json.data.access_code };
  }

  /** The source of truth for a payment; webhooks only prompt us to ask. */
  async verify(reference: string): Promise<PaystackTransaction> {
    const creds = await this.credentials();
    const { json, status } = await this.call<PaystackTransaction>(creds, `/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    if (!json?.status || !json.data) throw new BadGatewayException(`Paystack verify failed (HTTP ${status}): ${json?.message ?? 'no response'}`);
    return json.data;
  }

  /** Paystack signs each webhook with HMAC-SHA512 of the raw body using the secret key. */
  async validSignature(rawBody: Buffer | undefined, signature: string | undefined) {
    const creds = await this.settings.paystack();
    if (!creds || !rawBody || !signature) return false;
    const expected = createHmac('sha512', creds.secretKey).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Lists one transaction: 200 means the secret key works; 401 means it doesn't. */
  async testConnection(): Promise<CheckResult & { mode?: 'test' | 'live' }> {
    const creds = await this.settings.paystack();
    if (!creds) return { ok: false, message: 'No Paystack keys saved yet.' };
    const mode = creds.secretKey.startsWith('sk_live_') ? 'live' : 'test';
    try {
      const { status, json } = await this.call(creds, '/transaction?perPage=1', { method: 'GET' });
      if (status === 401) return { ok: false, message: 'Paystack rejected the secret key (401). Copy it again from Paystack › Settings › API Keys.' };
      if (status >= 500) return { ok: false, message: `Paystack had an error (${status}). Try again in a few minutes.` };
      if (!json?.status) return { ok: false, message: `Paystack answered: ${json?.message ?? `HTTP ${status}`}` };
      return {
        ok: true,
        mode,
        message: mode === 'test' ? 'Connected in TEST mode: payments are pretend money, for trying checkout.' : 'Connected in LIVE mode: customers pay real money.',
      };
    } catch (err) {
      return { ok: false, message: `Could not reach Paystack: ${(err as Error).message}` };
    }
  }

  private async credentials() {
    const creds = await this.settings.paystack();
    if (!creds) throw new ServiceUnavailableException('Online payments are not set up yet');
    return creds;
  }

  private async call<T>(creds: PaystackCredentials, path: string, init: RequestInit): Promise<{ json: PaystackResponse<T> | null; status: number }> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${creds.secretKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    try {
      return { json: JSON.parse(text) as PaystackResponse<T>, status: res.status };
    } catch {
      this.logger.warn(`Paystack ${res.status} from ${path}: ${text.slice(0, 200)}`);
      return { json: null, status: res.status };
    }
  }
}
