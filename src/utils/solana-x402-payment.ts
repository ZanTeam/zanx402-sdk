/**
 * Build x402 PAYMENT-SIGNATURE payload for Solana USDC (Dexter facilitator).
 * Buyer partially signs; facilitator adds fee-payer signature on verify/settle.
 */
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import type { PaymentOption } from '../types/credits.js';
import { NetworkError, PaymentRejectedError } from '../errors/index.js';

/** Dexter public facilitator fee payer (must match gateway / x402.dexter.cash) */
export const SOLANA_X402_FEE_PAYER = 'DEXVS3su4dZQWTvvPnLDJLRK1CeeKG6K3QqdzthgAkNV';

/** 官方节点在部分网络环境会 `fetch failed`，按顺序尝试多个公共 RPC */
const MAINNET_RPC_CANDIDATES = [
  'https://rpc.ankr.com/solana',
  'https://api.mainnet-beta.solana.com',
];

const DEVNET_RPC_CANDIDATES = [
  'https://rpc.ankr.com/solana_devnet',
  'https://api.devnet.solana.com',
];

function rpcCandidatesForNetwork(network: string, override?: string): string[] {
  const isMainnet = network === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  const base = isMainnet ? MAINNET_RPC_CANDIDATES : DEVNET_RPC_CANDIDATES;
  const list = override ? [override, ...base.filter((u) => u !== override)] : [...base];
  return [...new Set(list)];
}

async function getLatestBlockhashFromCandidates(rpcUrls: string[]): Promise<string> {
  let last: unknown;
  for (const url of rpcUrls) {
    try {
      const connection = new Connection(url, { commitment: 'confirmed' });
      const { blockhash } = await connection.getLatestBlockhash('finalized');
      return blockhash;
    } catch (e) {
      last = e;
    }
  }
  throw new NetworkError(
    `无法连接任一 Solana RPC（已尝试: ${rpcUrls.join(' → ')}）。` +
      `请在 X402ClientConfig 中设置 solanaRpcUrl 为可访问节点，或检查本机网络/代理。` +
      `最后错误: ${last instanceof Error ? last.message : String(last)}`,
    last,
  );
}

function normalizeOption(opt: PaymentOption & Record<string, unknown>): {
  network: string;
  scheme: string;
  asset: string;
  payTo: string;
  amount: string;
} {
  const asset = (opt.asset ?? opt.tokenAddress) as string | undefined;
  const payTo = (opt.payTo ?? opt.recipient) as string | undefined;
  if (!asset || !payTo) {
    throw new PaymentRejectedError('Solana payment option missing asset/payTo');
  }
  return {
    network: opt.network,
    scheme: (opt.scheme as string) ?? 'exact',
    asset,
    payTo,
    amount: opt.amount,
  };
}

/**
 * Pick a Solana `accepts` entry. Prefer `preferredNetwork` (CAIP-2) when set.
 */
export function pickSolanaPaymentOption(
  accepts: PaymentOption[],
  preferredNetwork?: string,
): (PaymentOption & Record<string, unknown>) | null {
  const sol = accepts.filter((a) => a.network?.startsWith('solana:'));
  if (sol.length === 0) return null;
  if (preferredNetwork) {
    const hit = sol.find((a) => a.network === preferredNetwork);
    if (hit) return hit as PaymentOption & Record<string, unknown>;
  }
  return sol[0] as PaymentOption & Record<string, unknown>;
}

export interface BuildSolanaX402PaymentPayloadParams {
  svmSecretKeyBase58: string;
  option: PaymentOption & Record<string, unknown>;
  solanaRpcUrl?: string;
}

/**
 * Build the JSON object to pass to `encodePaymentSignature()` for Solana settlement.
 */
export async function buildSolanaX402PaymentPayload(
  params: BuildSolanaX402PaymentPayloadParams,
): Promise<Record<string, unknown>> {
  const { svmSecretKeyBase58, option, solanaRpcUrl } = params;
  const n = normalizeOption(option);

  const rpcUrls = rpcCandidatesForNetwork(n.network, solanaRpcUrl);

  const feePayer = new PublicKey(SOLANA_X402_FEE_PAYER);
  const mint = new PublicKey(n.asset);
  const payToOwner = new PublicKey(n.payTo);

  const secret = bs58.decode(svmSecretKeyBase58);
  const user = Keypair.fromSecretKey(secret);

  const sourceAta = getAssociatedTokenAddressSync(mint, user.publicKey);
  const destAta = getAssociatedTokenAddressSync(mint, payToOwner);

  const amount = BigInt(n.amount);
  const decimals = 6;

  // Facilitator fee payer must not appear in instruction accounts (policy:fee_payer_not_isolated).
  // Buyer pays rent for idempotent dest ATA creation; facilitator only pays tx fee in header.
  const ixCreateDest = createAssociatedTokenAccountIdempotentInstruction(
    user.publicKey,
    destAta,
    payToOwner,
    mint,
    TOKEN_PROGRAM_ID,
  );

  const ixTransfer = createTransferCheckedInstruction(
    sourceAta,
    mint,
    destAta,
    user.publicKey,
    amount,
    decimals,
    [],
    TOKEN_PROGRAM_ID,
  );

  const blockhash = await getLatestBlockhashFromCandidates(rpcUrls);

  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [ixCreateDest, ixTransfer],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([user]);

  const transaction = Buffer.from(tx.serialize()).toString('base64');

  return {
    x402Version: 2,
    scheme: n.scheme,
    network: n.network,
    payload: {
      transaction,
    },
  };
}
