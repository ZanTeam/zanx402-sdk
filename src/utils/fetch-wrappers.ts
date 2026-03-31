import { HEADERS } from '../constants.js';

/**
 * Extract a session JWT from a settlement PAYMENT-RESPONSE header.
 * Returns null if the header is missing or does not contain a session.
 */
export function extractSettlementSession(
  response: Response,
): { token: string; expiresAt?: string } | null {
  const raw =
    response.headers.get(HEADERS.PAYMENT_RESPONSE) ??
    response.headers.get('X-PAYMENT-RESPONSE');
  if (!raw) return null;

  try {
    const decoded = typeof atob === 'function'
      ? atob(raw)
      : Buffer.from(raw, 'base64').toString('utf-8');
    const settle = JSON.parse(decoded);
    const info = settle?.extensions?.['x402-session']?.info;
    if (info?.token) {
      return { token: info.token, expiresAt: info.expiresAt };
    }
    if (settle?.token && typeof settle.token === 'string') {
      return { token: settle.token, expiresAt: settle.expiresAt };
    }
  } catch {
    // Malformed header — ignore
  }
  return null;
}

/**
 * Wrap any fetch to automatically inject Authorization: Bearer when a token
 * is available and not expired.
 *
 * @example
 * ```ts
 * const bearerFetch = withBearerAuth(fetch, () => myToken, () => isExpired());
 * ```
 */
export function withBearerAuth(
  baseFetch: typeof globalThis.fetch,
  getToken: () => string | null | undefined,
  isExpired?: () => boolean,
): typeof globalThis.fetch {
  return async (input, init?) => {
    const token = getToken();
    if (token && !(isExpired?.() ?? false)) {
      const headers = new Headers(init?.headers);
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return baseFetch(input, { ...init, headers });
    }
    return baseFetch(input, init);
  };
}

/**
 * Wrap any fetch to automatically extract session JWTs from
 * settlement PAYMENT-RESPONSE headers.
 *
 * @example
 * ```ts
 * const sessionFetch = withSessionExtraction(fetch, (token, expiresAt) => cache(token));
 * ```
 */
export function withSessionExtraction(
  baseFetch: typeof globalThis.fetch,
  onToken: (token: string, expiresAt?: string) => void,
): typeof globalThis.fetch {
  return async (input, init?) => {
    const response = await baseFetch(input, init);
    const session = extractSettlementSession(response);
    if (session) {
      onToken(session.token, session.expiresAt);
    }
    return response;
  };
}
