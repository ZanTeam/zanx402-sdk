/**
 * Build x402 PAYMENT-SIGNATURE payload for Solana USDC (Dexter facilitator).
 * Buyer partially signs; facilitator adds fee-payer signature on verify/settle.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import type { PaymentOption } from '../types/credits.js';
import type { SvmSigner } from '../types/common.js';
import { NetworkError, PaymentRejectedError, X402Error } from '../errors/index.js';

/** Dexter public facilitator fee payer — fallback when `extra.feePayer` is absent from 402 accepts. */
export const SOLANA_X402_FEE_PAYER = '2DB2em3rbXAtmwsrEeBYAVfT3sYM2rdH8dgxoZvTXZqL';

/** SPL Memo program — facilitator tolerates it as a trailing instruction. */
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/**
 * Facilitator (x402 `exact` SVM scheme) requires a fixed positional instruction layout:
 *   [0] ComputeBudget SetComputeUnitLimit
 *   [1] ComputeBudget SetComputeUnitPrice (microLamports <= 5_000_000)
 *   [2] SPL Token transferChecked
 *   [3..] optional trailing instructions (e.g. memo)
 * See @x402/svm exact/facilitator verifyStaticPath — deviating fails with
 * `invalid_exact_svm_payload_transaction_instructions_length`.
 */
const DEFAULT_COMPUTE_UNIT_LIMIT = 100_000;
const DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 5000;

/** 官方节点在部分网络环境会 `fetch failed`，按顺序尝试多个公共 RPC */
const MAINNET_RPC_CANDIDATES = [
  'https://api.zan.top/public/solana-mainnet'
];

const DEVNET_RPC_CANDIDATES = [
  'https://api.zan.top/public/solana-devnet'
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
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
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

const SOLANA_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

function isDevnetNetwork(network: string): boolean {
  return network.includes(SOLANA_DEVNET_GENESIS);
}

async function getBlockhashFromGateway(
  gatewayUrl: string,
  network: string,
  fetchFn: typeof globalThis.fetch,
): Promise<string> {
  const netParam = isDevnetNetwork(network) ? 'devnet' : 'mainnet';
  const url = `${gatewayUrl.replace(/\/+$/, '')}/api/solana/blockhash?network=${netParam}`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new NetworkError(`Gateway blockhash endpoint returned ${res.status}: ${url}`);
  }
  const data = await res.json() as { blockhash?: string };
  if (!data.blockhash) {
    throw new NetworkError(`Gateway blockhash response missing blockhash field`);
  }
  return data.blockhash;
}

async function getBlockhash(
  network: string,
  gatewayUrl?: string,
  solanaRpcUrl?: string,
  fetchFn?: typeof globalThis.fetch,
): Promise<string> {
  // Prefer gateway endpoint (same node as facilitator, avoids blockhash mismatch)
  if (gatewayUrl) {
    try {
      return await getBlockhashFromGateway(gatewayUrl, network, fetchFn ?? globalThis.fetch);
    } catch {
      // fall through to direct RPC
    }
  }
  // Fallback: direct RPC connection
  return getLatestBlockhashFromCandidates(rpcCandidatesForNetwork(network, solanaRpcUrl));
}

const DEFAULT_USDC_DECIMALS = 6;

function randomMemoNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeOption(opt: PaymentOption & Record<string, unknown>): {
  network: string;
  scheme: string;
  asset: string;
  payTo: string;
  amount: string;
  decimals: number;
  feePayer: string;
  memo?: string;
} {
  const asset = (opt.asset ?? opt.tokenAddress) as string | undefined;
  const payTo = (opt.payTo ?? opt.recipient) as string | undefined;
  if (!asset || !payTo) {
    throw new PaymentRejectedError('Solana payment option missing asset/payTo');
  }
  const extra = opt.extra as { feePayer?: string; memo?: string } | undefined;
  return {
    network: opt.network,
    scheme: (opt.scheme as string) ?? 'exact',
    asset,
    payTo,
    amount: opt.maxAmountRequired ?? opt.amount,
    decimals: opt.decimals ?? DEFAULT_USDC_DECIMALS,
    feePayer: extra?.feePayer ?? SOLANA_X402_FEE_PAYER,
    memo: extra?.memo,
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
    const available = sol.map((a) => a.network).filter(Boolean).join(', ');
    throw new X402Error(
      `paymentNetwork "${preferredNetwork}" does not match any Solana entry in the gateway 402 accepts ` +
        `(available: ${available}). SOLANA_RPC_URL only selects RPC for blockhash; it does not change the ` +
        `settlement network sent to the facilitator. Use the exact CAIP-2 from accepts, or unset paymentNetwork ` +
        `to use the first Solana option (often mainnet).`,
      'PAYMENT_NETWORK_MISMATCH',
    );
  }
  return sol[0] as PaymentOption & Record<string, unknown>;
}

export interface BuildSolanaX402PaymentPayloadParams {
  /** Raw Base58 secret key — used when svmSigner is not provided. */
  svmSecretKeyBase58?: string;
  /** Abstract signer — takes precedence over svmSecretKeyBase58. */
  svmSigner?: SvmSigner;
  option: PaymentOption & Record<string, unknown>;
  /** Optional: override Solana RPC URL for blockhash (bypasses gateway endpoint). */
  solanaRpcUrl?: string;
  /** Gateway base URL — used for `/api/solana/blockhash` (preferred over direct RPC). */
  gatewayUrl?: string;
  /** Custom fetch implementation. */
  fetchFn?: typeof globalThis.fetch;
}

/**
 * Build the JSON object to pass to `encodePaymentSignature()` for Solana settlement.
 * Supports both raw secret key and abstract SvmSigner.
 */
export async function buildSolanaX402PaymentPayload(
  params: BuildSolanaX402PaymentPayloadParams,
): Promise<Record<string, unknown>> {
  const { svmSecretKeyBase58, svmSigner, option, solanaRpcUrl, gatewayUrl, fetchFn } = params;
  const n = normalizeOption(option);

  const blockhash = await getBlockhash(n.network, gatewayUrl, solanaRpcUrl, fetchFn);

  const feePayer = new PublicKey(n.feePayer);
  const mint = new PublicKey(n.asset);
  const payToOwner = new PublicKey(n.payTo);

  let userPublicKey: PublicKey;
  let signTx: (tx: VersionedTransaction) => Promise<VersionedTransaction>;

  if (svmSigner) {
    userPublicKey = new PublicKey(svmSigner.publicKey);
    if (!svmSigner.signTransaction) {
      throw new PaymentRejectedError(
        'SvmSigner.signTransaction is required for auto-payment. ' +
        'Implement signTransaction() or provide svmPrivateKey instead.',
      );
    }
    const signer = svmSigner;
    signTx = async (tx: VersionedTransaction) => {
      const signed = await signer.signTransaction!(tx.serialize());
      return VersionedTransaction.deserialize(signed);
    };
  } else if (svmSecretKeyBase58) {
    const secret = bs58.decode(svmSecretKeyBase58);
    const user = Keypair.fromSecretKey(secret);
    userPublicKey = user.publicKey;
    signTx = async (tx: VersionedTransaction) => {
      tx.sign([user]);
      return tx;
    };
  } else {
    throw new PaymentRejectedError('No SVM credential available for payment signing.');
  }

  const sourceAta = getAssociatedTokenAddressSync(mint, userPublicKey);
  const destAta = getAssociatedTokenAddressSync(mint, payToOwner);

  const amount = BigInt(n.amount);
  const decimals = n.decimals;

  // Facilitator requires this exact positional layout: [computeLimit, computePrice, transferChecked, ...optional]
  const ixComputeLimit = ComputeBudgetProgram.setComputeUnitLimit({
    units: DEFAULT_COMPUTE_UNIT_LIMIT,
  });

  const ixComputePrice = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: DEFAULT_COMPUTE_UNIT_PRICE_MICROLAMPORTS,
  });

  const ixTransfer = createTransferCheckedInstruction(
    sourceAta,
    mint,
    destAta,
    userPublicKey,
    amount,
    decimals,
    [],
    TOKEN_PROGRAM_ID,
  );

  const memoText = n.memo ?? randomMemoNonce();
  const ixMemo = new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memoText, 'utf-8'),
  });

  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [ixComputeLimit, ixComputePrice, ixTransfer, ixMemo],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  const signedTx = await signTx(tx);

  const transaction = Buffer.from(signedTx.serialize()).toString('base64');

  return {
    x402Version: 2,
    scheme: n.scheme,
    network: n.network,
    payload: {
      transaction,
    },
  };
}
