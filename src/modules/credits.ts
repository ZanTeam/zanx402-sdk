import type { BalanceResponse, PurchaseSuccess, UsageResponse, UsageQueryParams, PaymentStatus } from '../types/credits.js';
import type { BundleType } from '../types/common.js';
import { HttpClient } from '../utils/http.js';
import { ENDPOINTS, HEADERS } from '../constants.js';
import { InsufficientCreditsError, PaymentRejectedError, X402Error } from '../errors/index.js';
import { parsePaymentRequired, encodePaymentSignature, buildPaymentSignaturePayload } from '../utils/x402.js';
import type { AuthModule } from './auth.js';

export class CreditsModule {
  private readonly http: HttpClient;
  private readonly auth: AuthModule;

  constructor(http: HttpClient, auth: AuthModule) {
    this.http = http;
    this.auth = auth;
  }

  /** Get current credit balance */
  async getBalance(): Promise<BalanceResponse> {
    await this.auth.ensureAuthenticated();
    const { data, status } = await this.http.get<BalanceResponse>(ENDPOINTS.BALANCE);
    if (status !== 200) {
      throw new X402Error(`Failed to get balance: status ${status}`, 'BALANCE_ERROR', status, data);
    }
    return data;
  }

  /**
   * Purchase credits via x402 payment flow.
   * 1. POST /credits/purchase/{bundle} without signature → 402 + PAYMENT-REQUIRED
   * 2. Construct EIP-3009 payment signature from wallet
   * 3. Retry with PAYMENT-SIGNATURE header → 200 + credits topped up
   */
  async purchaseCredits(bundle: BundleType = 'default', paymentSignature?: string): Promise<PurchaseSuccess> {
    await this.auth.ensureAuthenticated();

    const path = `${ENDPOINTS.PURCHASE}/${bundle}`;

    if (paymentSignature) {
      return this.completePurchase(path, paymentSignature);
    }

    const initResponse = await this.http.post<PurchaseSuccess>(path);

    if (initResponse.status === 200) {
      return initResponse.data;
    }

    if (initResponse.status !== 402) {
      throw new X402Error(
        `Unexpected response from purchase: ${initResponse.status}`,
        'PURCHASE_ERROR',
        initResponse.status,
        initResponse.data,
      );
    }

    const paymentRequired = parsePaymentRequired(initResponse.headers);
    if (!paymentRequired || paymentRequired.accepts.length === 0) {
      throw new PaymentRejectedError('402 received but no payment options available');
    }

    return {
      ...initResponse.data,
      _paymentRequired: paymentRequired,
    } as PurchaseSuccess & { _paymentRequired: typeof paymentRequired };
  }

  /**
   * Complete a purchase with a pre-built payment signature.
   * Typically called after the wallet has signed the EIP-3009 authorization.
   */
  async completePurchase(path: string, paymentSignature: string): Promise<PurchaseSuccess> {
    const { data, status } = await this.http.post<PurchaseSuccess>(path, undefined, {
      headers: { [HEADERS.PAYMENT_SIGNATURE]: paymentSignature },
    });

    if (status !== 200) {
      throw new PaymentRejectedError(
        `Payment rejected with status ${status}: ${JSON.stringify(data)}`,
      );
    }

    return data;
  }

  /** Query usage records */
  async getUsage(params: UsageQueryParams = {}): Promise<UsageResponse> {
    await this.auth.ensureAuthenticated();
    const qs = this.http.buildQueryString({
      limit: params.limit,
      offset: params.offset,
      provider: params.provider,
    });
    const { data, status } = await this.http.get<UsageResponse>(`${ENDPOINTS.USAGE}${qs}`);
    if (status !== 200) {
      throw new X402Error(`Failed to get usage: status ${status}`, 'USAGE_ERROR', status, data);
    }
    return data;
  }

  /** Query a specific payment status by idempotency key */
  async getPaymentStatus(idempotencyKey: string): Promise<PaymentStatus> {
    await this.auth.ensureAuthenticated();
    const { data, status } = await this.http.get<PaymentStatus>(
      `${ENDPOINTS.PAYMENT_STATUS}/${encodeURIComponent(idempotencyKey)}`,
    );
    if (status !== 200) {
      throw new X402Error(`Failed to get payment status: ${status}`, 'PAYMENT_STATUS_ERROR', status, data);
    }
    return data;
  }
}
