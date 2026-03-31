/**
 * SIWE (Sign-In with Ethereum) message builder.
 * Constructs EIP-4361 compliant messages for wallet authentication.
 */
export interface SiweMessageParams {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId?: number;
  statement?: string;
  issuedAt?: string;
  expirationTime?: string;
  version?: string;
}

export function buildSiweMessage(params: SiweMessageParams): string {
  const {
    domain,
    address,
    uri,
    nonce,
    chainId = 1,
    statement = 'Sign in to x402 Gateway Platform',
    issuedAt = new Date().toISOString(),
    version = '1',
  } = params;

  const lines = [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    statement,
    '',
    `URI: ${uri}`,
    `Version: ${version}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ];

  if (params.expirationTime) {
    lines.push(`Expiration Time: ${params.expirationTime}`);
  }

  return lines.join('\n');
}

/** Extract domain from a gateway URL */
export function extractDomain(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Generate a random nonce (alphanumeric, 16 chars) with rejection sampling to eliminate modulo bias. */
export function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const limit = 256 - (256 % chars.length); // 248 — largest multiple of 62 ≤ 256
  const result: string[] = [];
  while (result.length < 16) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit) {
        result.push(chars[b % chars.length]);
        if (result.length === 16) break;
      }
    }
  }
  return result.join('');
}
