# @zan_team/x402

TypeScript SDK for the **x402 Gateway Platform** — access blockchain RPC and Web2 SaaS APIs with on-chain USDC payments via the [x402 protocol](https://x402.org).

Inspired by [QuickNode SDK](https://www.quicknode.com/docs/quicknode-sdk), featuring modular architecture, tree-shakeable imports, and automatic payment flow.

## Installation

```bash
npm install @zan_team/x402 viem
```

## Quick Start

```typescript
import { X402Client } from '@zan_team/x402';

const client = new X402Client({
  gatewayUrl: 'https://x402.zan.top',
  privateKey: '0x...',
  autoPayment: true,          // auto-purchase credits on 402
  defaultBundle: 'default',   // bundle for auto-purchase
});

// Authenticate (auto-handled on first request)
await client.authenticate();

// JSON-RPC call
const blockNumber = await client.call('eth', 'mainnet', 'eth_blockNumber');
console.log(blockNumber.result);

// Credit balance
const balance = await client.getBalance();
console.log(`Credits: ${balance.balance}`);
```

## Architecture

```
X402Client
├── auth       — AuthModule     (SIWE wallet authentication + JWT lifecycle)
├── credits    — CreditsModule  (balance, purchase, usage, payment status)
├── rpc        — RpcModule      (JSON-RPC calls, batch, generic provider forwarding)
└── discovery  — DiscoveryModule(health, providers, networks, bundles, x402 capability)
```

### Tree-Shaking

Import only the modules you need:

```typescript
import { RpcModule } from '@zan_team/x402/rpc';
import { DiscoveryModule } from '@zan_team/x402/credits';
```

## Configuration

```typescript
interface X402ClientConfig {
  gatewayUrl: string;           // Gateway base URL
  wallet?: WalletClient;        // viem WalletClient for signing
  privateKey?: `0x${string}`;   // Alternative: hex private key
  chainType?: 'EVM' | 'SVM';   // Auth chain type (default: 'EVM')
  autoPayment?: boolean;        // Auto-purchase on 402 (default: false)
  defaultBundle?: BundleType;   // Bundle for auto-purchase (default: 'default')
  timeout?: number;             // Request timeout in ms (default: 30000)
  fetch?: typeof fetch;         // Custom fetch implementation
}
```

## API Reference

### Authentication

```typescript
// SIWE authentication — returns JWT + account info
const auth = await client.authenticate();
// { token, expiresIn, wallet, chainType, tier, balance }

// Access auth module directly
client.auth.getSession();    // current session
client.auth.isExpired();     // check expiry
client.auth.clearSession();  // logout
```

### RPC Calls

```typescript
// Single JSON-RPC call (auto-payment on 402 if enabled)
const result = await client.call('eth', 'mainnet', 'eth_blockNumber');
const balance = await client.call('eth', 'mainnet', 'eth_getBalance', [
  '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  'latest',
]);

// Batch RPC (single HTTP request)
const results = await client.rpc.batch('eth', 'mainnet', [
  { method: 'eth_blockNumber' },
  { method: 'eth_gasPrice' },
  { method: 'net_version' },
]);

// Generic provider call (AI, data APIs, etc.)
const aiResult = await client.forward('/api/ai/gpt4', {
  method: 'POST',
  body: { prompt: 'Explain x402 protocol' },
});
```

### Credits

```typescript
// Check balance
const bal = await client.getBalance();
// { wallet, balance, totalPurchased, totalConsumed, tier }

// Purchase credits (triggers x402 payment flow)
const receipt = await client.purchaseCredits('default');
// { success, bundle, creditsPurchased, balance, tier, txHash }

// Query usage
const usage = await client.getUsage({
  limit: 50,
  offset: 0,
  provider: 'zan-rpc',
});

// Check payment status
const status = await client.getPaymentStatus('idempotency-key-123');
```

### Discovery (No Auth Required)

```typescript
// Health check
const health = await client.health();

// List providers
const { providers } = await client.listProviders();

// List supported networks
const { networks } = await client.listNetworks();

// List credit bundles
const { bundles } = await client.listBundles();

// x402 capability declaration
const capability = await client.getX402Capability();
```

## Auto-Payment Flow

When `autoPayment: true`, the SDK handles 402 responses automatically:

```
Client                   Gateway                  Facilitator
  │                        │                          │
  │── POST /rpc/eth/main ─>│                          │
  │<── 402 insufficient ───│                          │
  │                        │                          │
  │  [auto-purchase triggered]                        │
  │── POST /credits/purchase/default ────────────────>│
  │<── 402 + PAYMENT-REQUIRED ───────────────────────│
  │                        │                          │
  │  [sign EIP-3009 transferWithAuthorization]        │
  │── POST /credits/purchase/default (w/ signature) ─>│
  │                        │── POST /verify ─────────>│
  │                        │<── valid, txHash ────────│
  │<── 200 + credits ─────│                          │
  │                        │                          │
  │── POST /rpc/eth/main ─>│  [retry original call]   │
  │<── 200 + result ───────│                          │
```

## Error Handling

```typescript
import {
  AuthenticationError,
  InsufficientCreditsError,
  InsufficientFundsError,
  PaymentRejectedError,
  ProviderNotFoundError,
  MethodNotAllowedError,
  UpstreamError,
  NetworkError,
} from '@zan_team/x402';

try {
  await client.call('eth', 'mainnet', 'eth_blockNumber');
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    console.log(`Need ${err.required} credits, have ${err.balance}`);
  } else if (err instanceof UpstreamError) {
    console.log(`Provider error, refunded: ${err.creditRefunded}`);
  } else if (err instanceof NetworkError) {
    console.log('Network issue:', err.message);
  }
}
```

## Using with viem WalletClient

```typescript
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { X402Client } from '@zan_team/x402';

const account = privateKeyToAccount('0x...');
const walletClient = createWalletClient({
  account,
  chain: mainnet,
  transport: http(),
});

const client = new X402Client({
  gatewayUrl: 'https://x402.zan.top',
  wallet: walletClient,
  autoPayment: true,
});
```

## Development

```bash
# Install dependencies
npm install

# Type check
npx tsc --noEmit

# Run tests
npm test

# Build (ESM + CJS)
npm run build
```

## Project Structure

```
sdk/typescript/
├── src/
│   ├── index.ts           # Public API re-exports
│   ├── client.ts          # X402Client main entry
│   ├── constants.ts       # Default config / endpoint paths
│   ├── types/             # TypeScript type definitions
│   │   ├── common.ts      # Shared types (config, enums)
│   │   ├── auth.ts        # Auth request/response types
│   │   ├── credits.ts     # Credits/payment types
│   │   ├── discovery.ts   # Discovery endpoint types
│   │   └── provider.ts    # JSON-RPC / provider types
│   ├── modules/           # Feature modules
│   │   ├── auth.ts        # SIWE authentication + JWT
│   │   ├── credits.ts     # Balance, purchase, usage
│   │   ├── rpc.ts         # JSON-RPC + generic forwarding
│   │   └── discovery.ts   # Health, providers, networks
│   ├── errors/            # Custom error hierarchy
│   │   └── index.ts
│   └── utils/             # Internal utilities
│       ├── http.ts        # HTTP client with timeout
│       ├── siwe.ts        # SIWE message builder
│       └── x402.ts        # x402 payment helpers
├── tests/                 # Vitest unit tests
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## License

MIT
