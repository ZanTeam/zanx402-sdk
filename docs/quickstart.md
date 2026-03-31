# 快速上手

5 分钟完成安装、鉴权、首次 RPC 调用与额度管理。

> 配置项与错误类型的完整说明请参阅 [README](../README.zh-CN.md)。

---

## 前置条件

| 项目 | 要求 |
|---|---|
| Node.js | >= 18 |
| 包管理器 | npm / pnpm / yarn |
| 钱包私钥 | EVM `0x` 十六进制私钥 **或** Solana Base58 密钥 |

> 私钥仅用于本地签名（SIWE/SIWS + EIP-3009），不会发送到网关。建议通过环境变量传入。

---

## 1. 安装

### 从 npm 安装

```bash
npm install @zan_team/x402 viem
```

Solana 可选依赖（仅 SVM 鉴权/支付需要）：

```bash
npm install @solana/web3.js @solana/spl-token bs58 tweetnacl
```

### 从源码本地安装

```bash
git clone https://code.alipay.com/chain-lab/zanx402-sdk.git
cd zanx402-sdk
npm install
npm run build        # ESM + CJS → dist/
```

在业务项目中引用：

**`npm link`（全局软链接）**

```bash
cd zanx402-sdk && npm link
cd your-project  && npm link @zan_team/x402
```

**本地路径依赖**

```jsonc
// your-project/package.json
{
  "dependencies": {
    "@zan_team/x402": "file:../zanx402-sdk",
    "viem": ">=2.0.0"
  }
}
```

```bash
npm install
```

> 修改 SDK 源码后需重新 `npm run build`。

---

## 2. 初始化客户端

### EVM（推荐：工厂函数 + 预鉴权）

```typescript
import { createX402Client } from '@zan_team/x402';

const client = await createX402Client({
  gatewayUrl: 'https://x402.zan.top',
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  autoPayment: true,
  preAuth: true,
});
```

`preAuth: true` 在返回前完成 SIWE + JWT，适合长存活服务和 Agent 进程。

### EVM（viem WalletClient）

```typescript
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { X402Client } from '@zan_team/x402';

const wallet = createWalletClient({
  account: privateKeyToAccount('0x...'),
  chain: mainnet,
  transport: http(),
});

const client = new X402Client({
  gatewayUrl: 'https://x402.zan.top',
  wallet,
  autoPayment: true,
});
```

### Solana (SVM)

```typescript
const client = await createX402Client({
  gatewayUrl: 'https://x402.zan.top',
  svmPrivateKey: process.env.SVM_PRIVATE_KEY!,
  autoPayment: true,
  preAuth: true,
});
```

SDK 根据传入密钥类型自动推断 `chainType`。

---

## 3. RPC 调用

```typescript
const block = await client.call('eth', 'mainnet', 'eth_blockNumber');
console.log('最新区块:', block.result);

const bal = await client.call('eth', 'mainnet', 'eth_getBalance', [
  '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18', 'latest',
]);
console.log('ETH 余额 (wei):', bal.result);
```

路径 `/rpc/{ecosystem}/{network}` 由 SDK 自动拼接并注入 JWT。额度不足且 `autoPayment: true` 时自动购额并重试。

### 批量 RPC

```typescript
const results = await client.rpc.batch('eth', 'mainnet', [
  { method: 'eth_blockNumber' },
  { method: 'eth_gasPrice' },
  { method: 'net_version' },
]);
results.forEach((r) => console.log(r.result));
```

---

## 4. 额度管理

```typescript
const balance = await client.getBalance();
console.log(`余额: ${balance.balance}  等级: ${balance.tier}`);

const receipt = await client.purchaseCredits('default');
console.log(`已购 ${receipt.creditsPurchased} 额度  txHash: ${receipt.txHash}`);

const usage = await client.getUsage({ limit: 10 });
usage.records.forEach((r) =>
  console.log(`${r.methodName}  cost=${r.creditCost}  ${r.latencyMs}ms`),
);
```

---

## 5. 发现网关能力

以下接口**无需鉴权**，适合启动时探测可用网络与套餐：

```typescript
const health = await client.health();
const { networks } = await client.listNetworks();
const { bundles } = await client.listBundles();
const capability = await client.getX402Capability();
```

---

## 6. 透明 fetch

`client.fetch()` 与 `globalThis.fetch` 签名一致，自动注入 JWT 与处理 402。适合已有 HTTP 调用链或 MCP Tool Server 场景：

```typescript
const res = await client.fetch('/rpc/eth/mainnet', {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'eth_blockNumber', params: [],
  }),
});
console.log(await res.json());
```

---

## 7. 错误处理

```typescript
import {
  InsufficientCreditsError,
  InsufficientFundsError,
  UpstreamError,
  SessionExpiredError,
  NetworkError,
} from '@zan_team/x402';

try {
  await client.call('eth', 'mainnet', 'eth_blockNumber');
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    console.error(`额度不足: 需 ${err.required}, 余 ${err.balance}`);
  } else if (err instanceof SessionExpiredError) {
    await client.authenticate();
  } else if (err instanceof NetworkError) {
    console.error('网络异常:', err.message);
  }
}
```

> 完整错误类型与字段见 [README § 错误层次](../README.zh-CN.md#错误层次)。

---

## 8. 完整示例：AI Agent 链上结算

```typescript
import { createX402Client } from '@zan_team/x402';

async function main() {
  const client = await createX402Client({
    gatewayUrl: 'https://x402.zan.top',
    privateKey: process.env.PRIVATE_KEY as `0x${string}`,
    autoPayment: true,
    preAuth: true,
  });

  const { networks } = await client.listNetworks();
  console.log(`可用网络: ${networks.length} 个`);

  const { balance } = await client.getBalance();
  console.log(`当前额度: ${balance}`);

  const block = await client.call('eth', 'mainnet', 'eth_blockNumber');
  console.log(`最新区块: ${block.result}`);

  const res = await client.fetch('/rpc/eth/mainnet', {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_getBlockByNumber', params: ['latest', false],
    }),
  });
  console.log(await res.json());
}

main().catch(console.error);
```

---

## 下一步

- 全部配置项与类型定义 → [README.zh-CN.md](../README.zh-CN.md)
- 测试用例 → [`tests/`](../tests/)
