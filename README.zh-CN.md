# @zan_team/x402

面向 **x402 网关平台** 的 TypeScript SDK。实现 [x402 协议](https://x402.org) HTTP 付费语义——工作负载通过统一网关访问 **JSON-RPC**、**Provider HTTP 路由** 与 **Web2 SaaS** 能力，在 Facilitator 要求下以**链上 USDC** 完成结算。

| 能力 | 说明 |
|---|---|
| 鉴权 | SIWE (EVM) / SIWS (SVM) → JWT 会话，自动续签 |
| 支付自动化 | 透明 402 → 购额 → 链上签名 → 重试 |
| 多链 | EVM 经由 viem；可选 Solana 路径（`@solana/web3.js`） |
| 传输 | `client.call()` 高级 RPC、`client.fetch()` 标准 HTTP |
| 发现 | 网络、套餐、x402 能力声明——无需鉴权 |
| 打包 | ESM + CJS 双构建，子路径导出，支持 tree-shaking |

**面向 AI Agent 与自主系统** — 统一会话原语、机器可解析的 402 付费质询、发现优先设计，适配动态工具目录与运行时规划。详见 [快速上手](./docs/quickstart.md)。

## 安装

```bash
npm install @zan_team/x402 viem
```

Solana 可选依赖（仅在使用 SVM 鉴权 / 支付时需要）：

```bash
npm install @solana/web3.js @solana/spl-token bs58 tweetnacl
```

> 从源码本地安装请参阅 [快速上手 § 从源码本地安装](./docs/quickstart.md#从源码本地安装)。

## 快速示例

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

## 架构

```
X402Client
├── auth       AuthModule      SIWE/SIWS + JWT 生命周期
├── credits    CreditsModule   余额 · 购买 · 用量 · 支付状态
├── rpc        RpcModule       JSON-RPC · 批量 · 通用 Provider 转发
└── discovery  DiscoveryModule 健康 · Provider · 网络 · 套餐 · x402 能力
```

子路径导出：`@zan_team/x402/auth`、`/credits`、`/rpc`。`DiscoveryModule` 通过包根入口导出。

## 配置

```typescript
interface X402ClientConfig {
  gatewayUrl: string;
  // EVM
  wallet?: WalletClient;
  privateKey?: `0x${string}`;
  // SVM
  svmPrivateKey?: string;       // Base58
  paymentNetwork?: string;      // CAIP-2，如 "eip155:8453"
  solanaRpcUrl?: string;
  // 行为
  chainType?: 'EVM' | 'SVM';   // 根据传入密钥自动推断
  autoPayment?: boolean;        // 默认 false
  defaultBundle?: BundleType;   // 默认 'default'
  preAuth?: boolean;            // 创建时预鉴权
  timeout?: number;             // 毫秒，默认 30000
  fetch?: typeof fetch;         // 自定义 fetch
}
```

## 错误层次

所有错误继承 `X402Error`，携带 `code` 与可选 `statusCode`。

| 错误类 | HTTP | 场景 |
|---|---|---|
| `AuthenticationError` | 401 | SIWE/SIWS 被拒 |
| `SessionExpiredError` | 401 | JWT 过期 |
| `InsufficientCreditsError` | 402 | 额度不足（`required`、`balance`） |
| `InsufficientFundsError` | 402 | 链上 USDC 余额不足 |
| `PaymentRejectedError` | 402 | Facilitator 拒绝支付 |
| `MethodNotAllowedError` | 403 | 当前等级不允许该方法 |
| `ProviderNotFoundError` | 404 | 无匹配的 Provider 路由 |
| `UpstreamError` | 504 | Provider 故障（`creditRefunded`） |
| `NetworkError` | — | 传输 / 超时 |

## 自动支付流程

```
Client                   Gateway                  Facilitator
  │── POST /rpc/eth/main ─>│
  │<── 402 ────────────────│
  │── POST /purchase/default ──────────────────────>│
  │<── 402 + PAYMENT-REQUIRED ─────────────────────│
  │  [签名 EIP-3009 / Solana SPL]
  │── POST /purchase/default (+ signature) ────────>│
  │                        │── POST /verify ───────>│
  │                        │<── valid, txHash ──────│
  │<── 200 + credits ──────│
  │── POST /rpc/eth/main ─>│  [重试]
  │<── 200 + result ───────│
```

## 仓库结构

```
zanx402-sdk/
├── src/
│   ├── index.ts                  # 对外 API 再导出
│   ├── client.ts                 # X402Client + createX402Client
│   ├── constants.ts              # 端点路径、默认值
│   ├── types/
│   │   ├── common.ts             # 配置、枚举
│   │   ├── auth.ts               # 鉴权请求/响应
│   │   ├── credits.ts            # 额度、支付、用量
│   │   ├── discovery.ts          # 发现类响应
│   │   ├── provider.ts           # JSON-RPC 类型
│   │   └── index.ts              # 类型桶文件
│   ├── modules/
│   │   ├── auth.ts               # SIWE/SIWS + JWT
│   │   ├── credits.ts            # 余额、购买、用量
│   │   ├── rpc.ts                # JSON-RPC + 转发
│   │   └── discovery.ts          # 健康、网络、套餐
│   ├── errors/
│   │   └── index.ts              # X402Error 层次
│   └── utils/
│       ├── http.ts               # HTTP 客户端（含超时）
│       ├── siwe.ts               # SIWE 消息构造
│       ├── siws.ts               # SIWS 消息构造
│       ├── x402.ts               # EVM 支付辅助
│       └── solana-x402-payment.ts # SVM 支付辅助
├── tests/                        # vitest 单元测试
├── scripts/                      # CLI 辅助脚本
├── docs/
│   └── quickstart.md             # 快速上手指南
├── package.json
├── tsconfig.json
├── tsconfig.esm.json
├── tsconfig.cjs.json
└── vitest.config.ts
```

## 本地开发

```bash
npm install         # 安装依赖
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # ESM + CJS → dist/
```

要求 **Node.js >= 18**。

## 许可证

MIT

---

[English README](./README.md) | [快速上手 →](./docs/quickstart.md)
