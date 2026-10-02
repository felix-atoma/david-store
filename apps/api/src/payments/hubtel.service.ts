import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Hubtel Online Checkout: one hosted page for MTN, Telecel and AirtelTigo MoMo plus Visa/Mastercard.
 *
 * Endpoints and field names follow Hubtel's Online Checkout and Transaction Status docs.
 * Check them against the current docs (developers.hubtel.com) before go-live. The status
 * check API only answers from IP addresses Hubtel has whitelisted for the merchant account,
 * so the API host needs a fixed outbound IP.
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

@Injectable()
export class HubtelService {
  private readonly logger = new Logger(HubtelService.name);

  constructor(private readonly config: ConfigService) {}

  get configured() {
    return Boolean(this.config.get('HUBTEL_API_ID') && this.config.get('HUBTEL_API_KEY') && this.config.get('HUBTEL_MERCHANT_ACCOUNT'));
  }

  async initiateCheckout(req: CheckoutRequest): Promise<CheckoutResponse> {
    const body = {
      totalAmount: req.amount / 100,
      description: req.description,
      callbackUrl: req.callbackUrl,
      returnUrl: req.returnUrl,
      cancellationUrl: req.cancellationUrl,
      merchantAccountNumber: this.merchantAccount(),
      clientReference: req.clientReference,
      payeeName: req.payeeName,
      payeeMobileNumber: req.payeeMobileNumber,
      payeeEmail: req.payeeEmail,
    };
    const json = await this.call<{ responseCode: string; status?: string; data?: CheckoutResponse }>(INITIATE_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (json.responseCode !== '0000' || !json.data?.checkoutUrl) {
      this.logger.error(`Hubtel initiate failed for ${req.clientReference}: ${JSON.stringify(json)}`);
      throw new BadGatewayException('Could not start the payment. Please try again.');
    }
    return json.data;
  }

  /** The source of truth for whether a payment went through. Callbacks are only a prompt to ask. */
  async checkStatus(clientReference: string): Promise<TransactionStatus> {
    const url = `${STATUS_URL}/${encodeURIComponent(this.merchantAccount())}/status?clientReference=${encodeURIComponent(clientReference)}`;
    const json = await this.call<{ responseCode: string; data?: TransactionStatus }>(url, { method: 'GET' });
    if (json.responseCode !== '0000' || !json.data) {
      throw new BadGatewayException(`Hubtel status check failed (${json.responseCode})`);
    }
    return json.data;
  }

  private merchantAccount() {
    return this.config.getOrThrow<string>('HUBTEL_MERCHANT_ACCOUNT');
  }

  private async call<T>(url: string, init: RequestInit): Promise<T> {
    if (!this.configured) throw new ServiceUnavailableException('Online payments are not set up yet');
    const auth = Buffer.from(`${this.config.get('HUBTEL_API_ID')}:${this.config.get('HUBTEL_API_KEY')}`).toString('base64');
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.error(`Hubtel ${res.status} from ${url}: ${text.slice(0, 300)}`);
      throw new BadGatewayException('Payment provider returned an unexpected response');
    }
  }
}
