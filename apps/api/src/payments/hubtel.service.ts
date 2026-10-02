import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { HubtelCredentials, SettingsService } from '../common/settings.service';

/**
 * Hubtel Online Checkout: one hosted page for MTN, Telecel and AirtelTigo MoMo plus Visa/Mastercard.
 *
 * Endpoints and field names follow Hubtel's Online Checkout and Transaction Status docs.
 * Check them against the current docs (developers.hubtel.com) when the merchant account
 * is set up. The status check API only answers from IP addresses Hubtel has whitelisted
 * for the merchant account, so the API host's outbound IPs must be registered with Hubtel.
 */
const INITIATE_URL = 'https://payproxyapi.hubtel.com/items/initiate';
const STATUS_URL = 'https://api-txnstatus.hubtel.com/transactions';

export interface CheckoutRequest {
  /** GH₵ amount in pesewas; converted to cedis for Hubtel. */
  amount: number;
  description: string;
  clientReference: string;
  callbackUrl: string;
  returnUrl: string;
  cancellationUrl: string;
  payeeName?: string;
  payeeMobileNumber?: string;
  payeeEmail?: string;
}

export interface CheckoutResponse {
  checkoutId: string;
  checkoutUrl: string;
  checkoutDirectUrl?: string;
}

export interface TransactionStatus {
  /** Hubtel reports "Paid", "Unpaid" or "Refunded". */
  status: string;
  transactionId?: string;
  paymentMethod?: string;
  /** Cedis, as Hubtel returns it. */
  amount: number;
}

export interface CheckResult {
  ok: boolean;
  /** Plain-language result for the dashboard. */
  message: string;
}

export type ConnectionTest = CheckResult;

@Injectable()
export class HubtelService {
  private readonly logger = new Logger(HubtelService.name);

  constructor(private readonly settings: SettingsService) {}

  async configured() {
    return Boolean(await this.settings.hubtel());
  }

  async initiateCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
    const creds = await this.credentials();
    const body = {
      totalAmount: req.amount / 100,
      description: req.description,
      callbackUrl: req.callbackUrl,
      returnUrl: req.returnUrl,
      cancellationUrl: req.cancellationUrl,
      merchantAccountNumber: creds.merchantAccount,
      clientReference: req.clientReference,
      payeeName: req.payeeName,
      payeeMobileNumber: req.payeeMobileNumber,
      payeeEmail: req.payeeEmail,
    };
    const { json } = await this.call<{ responseCode: string; status?: string; data?: CheckoutResponse }>(creds, INITIATE_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (json?.responseCode !== '0000' || !json.data?.checkoutUrl) {
      this.logger.error(`Hubtel initiate failed for ${req.clientReference}: ${JSON.stringify(json)}`);
      throw new BadGatewayException('Could not start the payment. Please try again.');
    }
    return json.data;
  }

  /** The source of truth for whether a payment went through. Callbacks are only a prompt to ask. */
  async checkStatus(clientReference: string): Promise<TransactionStatus> {
    const creds = await this.credentials();
    const { json, status } = await this.call<{ responseCode: string; data?: TransactionStatus }>(creds, this.statusUrl(creds, clientReference), { method: 'GET' });
    if (json?.responseCode !== '0000' || !json.data) {
      throw new BadGatewayException(`Hubtel status check failed (HTTP ${status}, code ${json?.responseCode ?? 'none'})`);
    }
    return json.data;
  }

  /**
   * Two separate checks, because Hubtel's status API refuses unknown IPs before it looks at
   * the keys, so one call can't tell "wrong keys" from "IP not whitelisted":
   * 1. Keys: an intentionally invalid checkout request (amount 0). Bad keys get 401; good keys
   *    get a validation error, and no checkout is created.
   * 2. Status checks from this server: asks about a reference that doesn't exist. 403 means
   *    this server's IP isn't whitelisted yet.
   */
  async testConnection(): Promise<ConnectionTest & { keys: CheckResult; statusChecks: CheckResult }> {
    const creds = await this.settings.hubtel();
    if (!creds) {
      const none = { ok: false, message: 'No Hubtel keys saved yet.' };
      return { ...none, keys: none, statusChecks: none };
    }

    const keys = await this.probe(async () => {
      const { status } = await this.call(creds, INITIATE_URL, {
        method: 'POST',
        body: JSON.stringify({ totalAmount: 0, description: 'Connection test', merchantAccountNumber: creds.merchantAccount, clientReference: `TEST-${randomBytes(4).toString('hex')}` }),
      });
      if (status === 401 || status === 403) return { ok: false, message: `Hubtel rejected the API ID or API key (${status}). Check both and save again.` };
      if (status >= 500) return { ok: false, message: `Hubtel had an error (${status}). Try again in a few minutes.` };
      return { ok: true, message: 'Hubtel accepted the API keys.' };
    });

    const statusChecks = await this.probe(async () => {
      const { status } = await this.call(creds, this.statusUrl(creds, `TEST-${randomBytes(4).toString('hex')}`), { method: 'GET' });
      if (status === 401) return { ok: false, message: 'Hubtel rejected the keys for status checks (401).' };
      if (status === 403) {
        return { ok: false, message: "Hubtel blocks payment status checks from this server (403): ask Hubtel to whitelist the server's outbound IP addresses. Until then, payments can't be confirmed." };
      }
      if (status >= 500) return { ok: false, message: `Hubtel had an error (${status}). Try again in a few minutes.` };
      return { ok: true, message: 'This server is allowed to check payment status.' };
    });

    const ok = keys.ok && statusChecks.ok;
    return {
      ok,
      message: ok ? 'Hubtel is connected. Customers can pay by MoMo and card.' : [keys, statusChecks].filter((c) => !c.ok).map((c) => c.message).join(' '),
      keys,
      statusChecks,
    };
  }

  private async probe(fn: () => Promise<CheckResult>): Promise<CheckResult> {
    try {
      return await fn();
    } catch (err) {
      return { ok: false, message: `Could not reach Hubtel: ${(err as Error).message}` };
    }
  }

  private statusUrl(creds: HubtelCredentials, clientReference: string) {
    return `${STATUS_URL}/${encodeURIComponent(creds.merchantAccount)}/status?clientReference=${encodeURIComponent(clientReference)}`;
  }

  private async credentials() {
    const creds = await this.settings.hubtel();
    if (!creds) throw new ServiceUnavailableException('Online payments are not set up yet');
    return creds;
  }

  private async call<T>(creds: HubtelCredentials, url: string, init: RequestInit): Promise<{ json: T | null; status: number }> {
    const auth = Buffer.from(`${creds.apiId}:${creds.apiKey}`).toString('base64');
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    try {
      return { json: JSON.parse(text) as T, status: res.status };
    } catch {
      this.logger.warn(`Hubtel ${res.status} from ${url.split('?')[0]}: ${text.slice(0, 300)}`);
      return { json: null, status: res.status };
    }
  }
}
