import type { Tier } from './common.js';

export interface PurchaseSuccess {
  success: boolean;
  bundle: string;
  creditsPurchased: number;
  balance: number;
  tier: Tier;
  paymentMode: string;
  txHash: string;
  paymentNetwork: string;
}

export interface BalanceResponse {
  wallet: string;
  balance: number;
  totalPurchased: number;
  totalConsumed: number;
  tier: Tier;
}

export interface UsageRecord {
  providerId: string;
  routePath: string;
  methodName: string;
  creditCost: number;
  responseStatus: number;
  isError: boolean;
  creditRefunded: boolean;
  latencyMs: number;
  createdAt: string;
}

export interface UsageResponse {
  records: UsageRecord[];
  total: number;
}

export interface UsageQueryParams {
  limit?: number;
  offset?: number;
  provider?: string;
}

export interface PaymentStatus {
  status: string;
  bundle: string;
  creditsPurchased: number;
  txHash: string;
  paymentNetwork: string;
  settledAt: string;
}

export interface PaymentRequiredPayload {
  accepts: PaymentOption[];
}

export interface PaymentOption {
  network: string;
  chainId?: number;
  tokenAddress: string;
  recipient: string;
  amount: string;
  description?: string;
}

export interface InsufficientCreditsBody {
  error: 'insufficient_credits';
  required: number;
  balance: number;
  purchaseUrl: string;
  bundles: BundleInfo[];
}

export interface BundleInfo {
  name: string;
  credits: number;
  price: number;
  description: string;
}
