/**
 * SIWS (Sign-In with Solana) — CAIP-122 compliant message builder.
 * Constructs messages compatible with Phantom / Solflare wallets
 * and the x402 SIWX extension.
 */

export interface SiwsMessageParams {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId?: string;
  statement?: string;
  issuedAt?: string;
  expirationTime?: string;
  version?: string;
}

export function buildSiwsMessage(params: SiwsMessageParams): string {
  const {
    domain,
    address,
    uri,
    nonce,
    chainId = 'mainnet',
    statement = 'Sign in to x402 Gateway Platform',
    issuedAt = new Date().toISOString(),
    version = '1',
  } = params;

  const lines = [
    `${domain} wants you to sign in with your Solana account:`,
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

/**
 * Sign a message with an Ed25519 keypair (Solana).
 * Accepts a Base58-encoded secret key (64 bytes = 32 private + 32 public).
 */
export async function signSolanaMessage(
  message: string,
  secretKeyBase58: string,
): Promise<{ signature: string; publicKey: string }> {
  const { default: bs58 } = await import('bs58' as string).catch(() => {
    throw new Error(
      'bs58 is required for Solana auth. Install it: npm install bs58',
    );
  });

  const nacl = await import('tweetnacl' as string).then(m => m.default ?? m).catch(() => {
    throw new Error(
      'tweetnacl is required for Solana auth. Install it: npm install tweetnacl',
    );
  });

  const secretKey: Uint8Array = bs58.decode(secretKeyBase58);
  const publicKey: Uint8Array = secretKey.slice(32);
  const msgBytes = new TextEncoder().encode(message);
  const sig: Uint8Array = nacl.sign.detached(msgBytes, secretKey);

  return {
    signature: bs58.encode(sig),
    publicKey: bs58.encode(publicKey),
  };
}
