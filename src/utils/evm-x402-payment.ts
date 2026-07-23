/**
 * Build x402 PAYMENT-SIGNATURE payload for EVM chains.
 * Signs an EIP-3009 transferWithAuthorization via EIP-712 typed data.
 */
import type { Account, Chain, Transport, WalletClient } from 'viem';
import type { PaymentOption } from '../types/credits.js';
import { PaymentRejectedError, X402Error } from '../errors/index.js';
import { buildPaymentSignaturePayload } from './x402.js';

const ERC20_NAME_VERSION_ABI = [
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'version', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const;

/**
 * Pick an EVM `accepts` entry. Prefer `preferredNetwork` (CAIP-2) when set.
 */
export function pickEvmPaymentOption(
  accepts: PaymentOption[],
  preferredNetwork?: string,
): PaymentOption | null {
  const evm = accepts.filter((a) => a.network?.startsWith('eip155:'));
  if (evm.length === 0) return null;
  if (preferredNetwork) {
    const hit = evm.find((a) => a.network === preferredNetwork);
    if (hit) return hit;
    const available = evm.map((a) => a.network).filter(Boolean).join(', ');
    throw new X402Error(
      `paymentNetwork "${preferredNetwork}" does not match any EVM entry in the gateway 402 accepts ` +
        `(available: ${available}). Unset paymentNetwork to use the first EVM option.`,
      'PAYMENT_NETWORK_MISMATCH',
    );
  }
  return evm[0];
}

function generateRandomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return ('0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
}

function parseChainId(option: PaymentOption): number {
  if (option.chainId) return option.chainId;
  const parts = option.network.split(':');
  if (parts.length >= 2) {
    const id = parseInt(parts[1], 10);
    if (!Number.isNaN(id)) return id;
  }
  throw new PaymentRejectedError(`Cannot determine chainId from payment option network: ${option.network}`);
}

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/**
 * Read token contract's EIP-712 domain name and version from on-chain.
 * Falls back to common defaults if the contract doesn't expose these.
 */
async function fetchTokenDomain(
  tokenAddress: `0x${string}`,
  chainId: number,
): Promise<{ name: string; version: string }> {
  const { createPublicClient, http } = await import('viem');

  const client = createPublicClient({
    chain: { id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrlForChain(chainId)] } } },
    transport: http(),
  });

  let name = 'USD Coin';
  let version = '2';

  try {
    name = await client.readContract({
      address: tokenAddress,
      abi: ERC20_NAME_VERSION_ABI,
      functionName: 'name',
    });
  } catch {
    // fallback to default
  }

  try {
    version = await client.readContract({
      address: tokenAddress,
      abi: ERC20_NAME_VERSION_ABI,
      functionName: 'version',
    });
  } catch {
    // fallback to default
  }

  return { name, version };
}

function rpcUrlForChain(chainId: number): string {
  switch (chainId) {
    case 8453: return 'https://mainnet.base.org';
    case 84532: return 'https://sepolia.base.org';
    case 1: return 'https://eth.drpc.org';
    case 11155111: return 'https://rpc.sepolia.org';
    case 1672: return 'https://rpc.pharos.xyz';
    case 688689: return 'https://atlantic.dplabs-internal.com'; // Pharos Atlantic Testnet
    default: return `https://rpc.ankr.com/eth`;
  }
}

export interface BuildEvmX402PaymentPayloadParams {
  /** Raw EVM private key — used when walletClient is not provided. */
  privateKey?: `0x${string}`;
  /** viem WalletClient — used when privateKey is not provided. */
  walletClient?: WalletClient<Transport, Chain, Account>;
  option: PaymentOption;
}

export async function buildEvmX402PaymentPayload(
  params: BuildEvmX402PaymentPayloadParams,
): Promise<Record<string, unknown>> {
  const { privateKey, walletClient, option } = params;

  const recipient = (option.recipient ?? option.payTo) as string | undefined;
  const tokenAddress = (option.tokenAddress ?? option.asset) as string | undefined;
  if (!recipient || !tokenAddress) {
    throw new PaymentRejectedError('EVM payment option missing recipient/tokenAddress');
  }

  const chainId = parseChainId(option);
  const nonce = generateRandomNonce();
  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + 3600;

  const tokenDomain = await fetchTokenDomain(tokenAddress as `0x${string}`, chainId);

  const domain = {
    name: tokenDomain.name,
    version: tokenDomain.version,
    chainId: BigInt(chainId),
    verifyingContract: tokenAddress as `0x${string}`,
  };

  let signerAddress: `0x${string}`;
  let signature: `0x${string}`;

  if (privateKey) {
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(privateKey);
    signerAddress = account.address;

    const message = {
      from: account.address,
      to: recipient as `0x${string}`,
      value: BigInt(option.amount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    };

    signature = await account.signTypedData({
      domain,
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    });
  } else if (walletClient) {
    signerAddress = walletClient.account.address;

    const message = {
      from: walletClient.account.address,
      to: recipient as `0x${string}`,
      value: BigInt(option.amount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce,
    };

    signature = await walletClient.signTypedData({
      domain,
      types: EIP3009_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    });
  } else {
    throw new PaymentRejectedError('No EVM credential available for payment signing.');
  }

  return buildPaymentSignaturePayload({
    from: signerAddress,
    to: recipient,
    value: option.amount,
    validAfter,
    validBefore,
    nonce,
    signature,
    network: option.network,
    chainId,
    tokenAddress,
    tokenName: tokenDomain.name,
    tokenVersion: tokenDomain.version,
  });
}
