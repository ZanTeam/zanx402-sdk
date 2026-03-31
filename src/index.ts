export { X402Client, createX402Client } from './client.js';

export { AuthModule } from './modules/auth.js';
export { CreditsModule } from './modules/credits.js';
export { RpcModule } from './modules/rpc.js';
export { DiscoveryModule } from './modules/discovery.js';

export {
  X402Error,
  AuthenticationError,
  InsufficientCreditsError,
  InsufficientFundsError,
  PaymentRejectedError,
  ProviderNotFoundError,
  MethodNotAllowedError,
  UpstreamError,
  SessionExpiredError,
  NetworkError,
} from './errors/index.js';

export { HttpClient, assertShape } from './utils/http.js';
export { buildSiweMessage, extractDomain, generateNonce } from './utils/siwe.js';
export { buildSiwsMessage, signSolanaMessage } from './utils/siws.js';
export {
  parsePaymentRequired,
  encodePaymentSignature,
  buildPaymentSignaturePayload,
} from './utils/x402.js';
export {
  buildSolanaX402PaymentPayload,
  pickSolanaPaymentOption,
  SOLANA_X402_FEE_PAYER,
} from './utils/solana-x402-payment.js';
export {
  extractSettlementSession,
  withBearerAuth,
  withSessionExtraction,
} from './utils/fetch-wrappers.js';

export type * from './types/index.js';

export {
  ENDPOINTS,
  HEADERS,
  DEFAULT_TIMEOUT,
  DEFAULT_GATEWAY_URL,
  DEFAULT_STATEMENT,
  SIWE_EXPIRY_MS,
} from './constants.js';
