# @zan_team/x402

TypeScript SDK for the **x402 Gateway Platform**. Implements the [x402 protocol](https://x402.org) HTTP payment semantics—workloads access **JSON-RPC**, **provider HTTP routes**, and **Web2 SaaS** surfaces through one gateway, settling in **on-chain USDC** when the facilitator requires it.

| Capability | Detail |
|---|---|
| Authentication | SIWE (EVM) / SIWS (SVM) → JWT session with auto-refresh |
| Payment automation | Transparent 402 → purchase → on-chain signature → retry |
| Multi-chain | EVM via viem; optional Solana path (`@solana/web3.js`) |
| Transport | `client.call()` high-level RPC, `client.fetch()` standard HTTP |
| Discovery | Networks, bundles, x402 capability — no auth required |
| Packaging | ESM + CJS dual build, subpath exports, tree-shakeable |

**For AI agents & autonomous systems** — single session primitive, machine-parseable 402 challenges, discovery-first design for dynamic tool catalogs. See [Quickstart](./docs/quickstart.md) for a step-by-step walkthrough.

## Installation

```bash
npm install @zan_team/x402 viem
```

Solana optional dependencies (only if using SVM auth / payment):

```bash
npm install @solana/web3.js @solana/spl-token bs58 tweetnacl
```

> For local development from source, see [Quickstart § Local Install](./docs/quickstart.md#从源码本地安装).

## Quick example

```typescript
import { createX402Client } from '@zan_team/x402';

const client = await createX402Client({
  gatewayUrl: 'https://x402.zan.top',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  autoPayment: true,
  preAuth: true,
});

const block = await client.call('eth', 'mainnet', 'eth_blockNumber');
console.log(block.result);
```

## Architecture

```
X402Client
├── auth       AuthModule      SIWE/SIWS + JWT lifecycle
├── credits    CreditsModule   balance · purchase · usage · payment status
├── rpc        RpcModule       JSON-RPC · batch · generic provider forward
└── discovery  DiscoveryModule health · providers · networks · bundles · x402 cap
```

Subpath exports: `@zan_team/x402/auth`, `/credits`, `/rpc`. `DiscoveryModule` via package root.

## Configuration

```typescript
interface X402ClientConfig {
  gatewayUrl: string;
  // EVM
  wallet?: WalletClient;
  privateKey?: `0x${string}`;
  // SVM
  svmPrivateKey?: string;       // Base58
  paymentNetwork?: string;      // CAIP-2, e.g. "eip155:8453"
  solanaRpcUrl?: string;
  // Behavior
  chainType?: 'EVM' | 'SVM';   // auto-detected from keys
  autoPayment?: boolean;        // default: false
  defaultBundle?: BundleType;   // default: 'default'
  preAuth?: boolean;            // pre-authenticate on creation
  timeout?: number;             // ms, default: 30000
  fetch?: typeof fetch;         // custom fetch impl
}
```

## Error hierarchy

All errors extend `X402Error` with typed `code` and optional `statusCode`.

| Error | HTTP | Scenario |
|---|---|---|
| `AuthenticationError` | 401 | SIWE/SIWS rejected |
| `SessionExpiredError` | 401 | JWT expired |
| `InsufficientCreditsError` | 402 | Not enough credits (`required`, `balance`) |
| `InsufficientFundsError` | 402 | On-chain USDC too low |
| `PaymentRejectedError` | 402 | Facilitator rejected payment |
| `MethodNotAllowedError` | 403 | Method not allowed for tier |
| `ProviderNotFoundError` | 404 | No matching provider route |
| `UpstreamError` | 504 | Provider failure (`creditRefunded`) |
| `NetworkError` | — | Transport / timeout |

## Auto-payment flow

```
Client                   Gateway                  Facilitator
  │── POST /rpc/eth/main ─>│
  │<── 402 ────────────────│
  │── POST /purchase/default ──────────────────────>│
  │<── 402 + PAYMENT-REQUIRED ─────────────────────│
  │  [sign EIP-3009 / Solana SPL]
  │── POST /purchase/default (+ signature) ────────>│
  │                        │── POST /verify ───────>│
  │                        │<── valid, txHash ──────│
  │<── 200 + credits ──────│
  │── POST /rpc/eth/main ─>│  [retry]
  │<── 200 + result ───────│
```

## Project structure

```
zanx402-sdk/
├── src/
│   ├── index.ts                  # public API re-exports
│   ├── client.ts                 # X402Client + createX402Client
│   ├── constants.ts              # endpoints, defaults
│   ├── types/
│   │   ├── common.ts             # config, enums
│   │   ├── auth.ts               # auth request/response
│   │   ├── credits.ts            # credits, payment, usage
│   │   ├── discovery.ts          # discovery responses
│   │   ├── provider.ts           # JSON-RPC types
│   │   └── index.ts              # type barrel
│   ├── modules/
│   │   ├── auth.ts               # SIWE/SIWS + JWT
│   │   ├── credits.ts            # balance, purchase, usage
│   │   ├── rpc.ts                # JSON-RPC + forward
│   │   └── discovery.ts          # health, networks, bundles
│   ├── errors/
│   │   └── index.ts              # X402Error hierarchy
│   └── utils/
│       ├── http.ts               # HTTP client w/ timeout
│       ├── siwe.ts               # SIWE message builder
│       ├── siws.ts               # SIWS message builder
│       ├── x402.ts               # EVM payment helpers
│       └── solana-x402-payment.ts # SVM payment helpers
├── tests/                        # vitest unit tests
├── scripts/                      # CLI helper scripts
├── docs/
│   └── quickstart.md             # step-by-step guide
├── package.json
├── tsconfig.json
├── tsconfig.esm.json
├── tsconfig.cjs.json
└── vitest.config.ts
```

## Development

```bash
npm install         # dependencies
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # ESM + CJS → dist/
```

Requires **Node.js >= 18**.

## License

MIT

---

[中文文档](./README.zh-CN.md) | [Quickstart →](./docs/quickstart.md)
