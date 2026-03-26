import type { PaymentRequiredPayload } from '../types/credits.js';
import { HEADERS } from '../constants.js';

/**
 * Parse the PAYMENT-REQUIRED header from a 402 response.
 * The header value is a Base64-encoded JSON object containing payment options.
 */
export function parsePaymentRequired(headers: Headers): PaymentRequiredPayload | null {
  const raw = headers.get(HEADERS.PAYMENT_REQUIRED);
  if (!raw) return null;

  try {
    const decoded = typeof atob === 'function'
      ? atob(raw)
      : Buffer.from(raw, 'base64').toString('utf-8');
    return JSON.parse(decoded) as PaymentRequiredPayload;
  } catch {
    return null;
  }
}

/**
 * Encode a payment signature to Base64 for the PAYMENT-SIGNATURE header.
 */
export function encodePaymentSignature(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return typeof btoa === 'function'
    ? btoa(json)
    : Buffer.from(json, 'utf-8').toString('base64');
}

/**
 * Build the x402 payment signature payload for EIP-3009 transferWithAuthorization.
 */
export interface TransferAuthParams {
  from: string;
  to: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
  signature: string;
  network: string;
  chainId?: number;
}

export function buildPaymentSignaturePayload(params: TransferAuthParams): Record<string, unknown> {
  return {
    x402Version: 2,
    scheme: 'exact',
    network: params.network,
    payload: {
      signature: params.signature,
      authorization: {
        from: params.from,
        to: params.to,
        value: params.value,
        validAfter: params.validAfter,
        validBefore: params.validBefore,
        nonce: params.nonce,
      },
    },
  };
}
