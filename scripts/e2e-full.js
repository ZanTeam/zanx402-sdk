#!/usr/bin/env node

/**
 * x402 SDK 全功能端到端测试
 *
 * 覆盖: Discovery · Auth · Credits · RPC · Batch · Fetch · AI (滚动结算) · Call History · Stats
 *
 * Usage:
 *   # Base Sepolia (默认)
 *   EVM_PRIVATE_KEY=0x... node scripts/e2e-full.js
 *
 *   # Pharos Atlantic
 *   EVM_PRIVATE_KEY=0x... PAYMENT_NETWORK=pharos node scripts/e2e-full.js
 *
 *   # Solana Devnet
 *   SVM_PRIVATE_KEY=<base58> PAYMENT_NETWORK=solana node scripts/e2e-full.js
 */

import { X402Client, createX402Client } from '../dist/esm/index.js';

// ── 支付网络预设 ──────────────────────────────────────────
const NETWORK_PRESETS = {
  'base-sepolia': { caip2: 'eip155:84532',  chainType: 'EVM', label: 'Base Sepolia' },
  'pharos':       { caip2: 'eip155:688689', chainType: 'EVM', label: 'Pharos Atlantic Testnet' },
  'solana':       { caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', chainType: 'SVM', label: 'Solana Devnet' },
};

function resolveNetwork(input) {
  if (!input || input === 'eip155:84532') return NETWORK_PRESETS['base-sepolia'];
  if (NETWORK_PRESETS[input]) return NETWORK_PRESETS[input];
  const chainType = input.startsWith('solana:') ? 'SVM' : 'EVM';
  return { caip2: input, chainType, label: input };
}

const GATEWAY = process.env.X402_GATEWAY_URL || 'https://x402-labs.unchartedw3s.com';
const AI_MODEL = process.env.X402_AI_MODEL || 'deepseek-v4-flash';
const network = resolveNetwork(process.env.PAYMENT_NETWORK);

const isSVM = network.chainType === 'SVM';
const PRIVATE_KEY = isSVM ? process.env.SVM_PRIVATE_KEY : process.env.EVM_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error(`❌ 请设置 ${isSVM ? 'SVM_PRIVATE_KEY' : 'EVM_PRIVATE_KEY'}`);
  process.exit(1);
}

let total = 0, passed = 0, failed = 0, skipped = 0;

function dump(obj) {
  return JSON.stringify(obj, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
}

async function test(name, fn) {
  total++;
  try {
    const { summary, response } = await fn();
    passed++;
    console.log(`  ✅ ${name} — ${summary}`);
    if (response !== undefined) console.log(`     ${dump(response)}`);
  } catch (e) {
    if (e === 'SKIP') { skipped++; console.log(`  ⏭️  ${name} — skipped`); }
    else { failed++; console.log(`  ❌ ${name} — ${e.message ?? e}${e.code ? ` [${e.code}]` : ''}`); }
  }
}

function section(title) { console.log(`\n━━ ${title} ━━`); }

async function run() {
  console.log(`\n[x402 SDK E2E]  gateway=${GATEWAY}  model=${AI_MODEL}`);
  console.log(`  network=${network.label} (${network.caip2})  chainType=${network.chainType}\n`);

  // ════════════════════════════════════════════════════════
  // 1. Discovery（公开接口，无需认证）
  // ════════════════════════════════════════════════════════
  section('1. Discovery');
  const pub = new X402Client({ gatewayUrl: GATEWAY, chainType: 'EVM' });

  await test('health', async () => {
    const r = await pub.health();
    return { summary: `status=${r.status}`, response: r };
  });

  let networkList;
  await test('listProviders', async () => {
    const r = await pub.listProviders();
    return { summary: `${r.providers.length} providers`, response: r };
  });

  await test('listNetworks', async () => {
    const r = await pub.listNetworks();
    networkList = r.networks;
    return { summary: `${networkList.length} networks`, response: r };
  });

  await test('listBundles', async () => {
    const r = await pub.listBundles();
    return { summary: r.bundles.map(x => x.name).join(', '), response: r };
  });

  await test('getX402Capability', async () => {
    const r = await pub.getX402Capability();
    return { summary: `name=${r.name}, version=${r.version}`, response: r };
  });

  await test('ai.listModels', async () => {
    const r = await pub.ai.listModels();
    return { summary: `${r.data.length} models`, response: r };
  });

  await test('ai.discover', async () => {
    const r = await pub.ai.discover();
    return { summary: `keys=[${Object.keys(r).join(', ')}]`, response: r };
  });

  await test('discovery.getAiPaymentNetworks', async () => {
    const r = await pub.discovery.getAiPaymentNetworks();
    const nets = r?.data?.networks ?? [];
    return { summary: `${nets.length} payment networks`, response: r };
  });

  // ════════════════════════════════════════════════════════
  // 2. Authentication
  // ════════════════════════════════════════════════════════
  section('2. Authentication');

  let client;
  await test('createX402Client + preAuth', async () => {
    client = await createX402Client({
      gatewayUrl: GATEWAY,
      ...(isSVM
        ? { svmPrivateKey: PRIVATE_KEY }
        : { privateKey: PRIVATE_KEY }),
      chainType: network.chainType,
      paymentNetwork: network.caip2,
      autoPayment: true,
      preAuth: true,
    });
    const session = client.auth.getSession();
    return { summary: `wallet=${session.wallet}, tier=${session.tier}`, response: session };
  });

  await test('getToken not empty', async () => {
    const token = client.getToken();
    if (!token) throw new Error('token is undefined');
    return { summary: `${token.slice(0, 20)}...` };
  });

  // ════════════════════════════════════════════════════════
  // 3. Credits
  // ════════════════════════════════════════════════════════
  section('3. Credits');

  await test('getBalance', async () => {
    const r = await client.getBalance();
    return { summary: `balance=${r.balance}, tier=${r.tier}`, response: r };
  });

  await test('purchaseCredits', async () => {
    try {
      const r = await client.purchaseCredits('default');
      return { summary: `credits=${r.creditsPurchased}, txHash=${r.txHash?.slice(0, 16)}...`, response: r };
    } catch (e) {
      if (e.code === 'INSUFFICIENT_FUNDS' || e.code === 'PAYMENT_REJECTED') {
        return { summary: `skipped (${e.code})` };
      }
      throw e;
    }
  });

  await test('getUsage', async () => {
    const r = await client.getUsage({ limit: 3 });
    return { summary: `${r.records?.length ?? 0} records`, response: r };
  });

  await test('getBalance after purchase', async () => {
    const r = await client.getBalance();
    return { summary: `balance=${r.balance}`, response: r };
  });

  // ════════════════════════════════════════════════════════
  // 4. RPC Calls
  // ════════════════════════════════════════════════════════
  section('4. RPC Calls');

  await test('call eth_blockNumber', async () => {
    const r = await client.call('eth', 'mainnet', 'eth_blockNumber');
    return { summary: `result=${r.result}`, response: r };
  });

  await test('call eth_chainId', async () => {
    const r = await client.call('eth', 'mainnet', 'eth_chainId');
    return { summary: `result=${r.result}`, response: r };
  });

  await test('call eth_gasPrice', async () => {
    const r = await client.call('eth', 'mainnet', 'eth_gasPrice');
    return { summary: `result=${r.result}`, response: r };
  });

  await test('call eth_getBalance', async () => {
    const r = await client.call('eth', 'mainnet', 'eth_getBalance', [
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'latest',
    ]);
    return { summary: `result=${r.result}`, response: r };
  });

  const hasSolana = networkList && networkList.some(n => n.ecosystem === 'solana');
  await test('call solana getSlot', async () => {
    if (!hasSolana) throw 'SKIP';
    const r = await client.call('solana', 'mainnet', 'getSlot');
    return { summary: `result=${r.result}`, response: r };
  });

  // ════════════════════════════════════════════════════════
  // 5. Batch RPC
  // ════════════════════════════════════════════════════════
  section('5. Batch RPC');

  await test('batch 3 methods', async () => {
    const r = await client.rpc.batch('eth', 'mainnet', [
      { method: 'eth_blockNumber' },
      { method: 'eth_chainId' },
      { method: 'net_version' },
    ]);
    return { summary: `[${r.map(x => x.result).join(', ')}]`, response: r };
  });

  // ════════════════════════════════════════════════════════
  // 6. Fetch API（透明代理）
  // ════════════════════════════════════════════════════════
  section('6. Fetch API');

  await test('fetch /rpc/eth/mainnet', async () => {
    const res = await client.fetch('/rpc/eth/mainnet', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    const data = await res.json();
    return { summary: `status=${res.status}, result=${data.result}`, response: data };
  });

  await test('fetch /health (public)', async () => {
    const res = await client.fetch('/health');
    const data = await res.json();
    return { summary: `status=${res.status}`, response: data };
  });

  // ════════════════════════════════════════════════════════
  // 7. AI Module（滚动结算）
  // ════════════════════════════════════════════════════════
  section('7. AI Chat (rolling settlement)');

  await test(`chat ${AI_MODEL} (1st call, may be free)`, async () => {
    try {
      const r = await client.chat(AI_MODEL, {
        messages: [{ role: 'user', content: 'Reply with exactly: hello x402' }],
        max_tokens: 32,
      });
      return { summary: `tokens=${r.data.usage.total_tokens}, txHash=${r.txHash ?? 'null'}`, response: r };
    } catch (e) {
      if (e.code === 'AI_PAYMENT_REQUIRED' || e.code === 'INSUFFICIENT_FUNDS') {
        return { summary: `expected 402 (${e.code})` };
      }
      throw e;
    }
  });

  await test(`chat ${AI_MODEL} (2nd call, settles previous)`, async () => {
    try {
      const r = await client.chat(AI_MODEL, {
        messages: [{ role: 'user', content: 'Reply with exactly: hello again' }],
        max_tokens: 32,
      });
      return { summary: `tokens=${r.data.usage.total_tokens}, txHash=${r.txHash ?? 'null'}, network=${r.paymentNetwork ?? 'null'}`, response: r };
    } catch (e) {
      if (e.code === 'INSUFFICIENT_FUNDS' || e.code === 'NO_EVM_CREDENTIALS') {
        return { summary: `skipped (${e.code})` };
      }
      throw e;
    }
  });

  // ════════════════════════════════════════════════════════
  // 8. AI Call History & Stats
  // ════════════════════════════════════════════════════════
  section('8. AI Call History & Stats');

  await test('ai.getCallHistory', async () => {
    const r = await client.ai.getCallHistory({ page: 0, size: 3 });
    const records = r?.data?.content ?? [];
    return { summary: `${records.length} records, totalElements=${r?.data?.totalElements ?? '?'}`, response: r };
  });

  await test('ai.getCallDetail', async () => {
    const h = await client.ai.getCallHistory({ page: 0, size: 1 });
    const records = h?.data?.content ?? [];
    if (records.length === 0) return { summary: 'no records to query' };
    const r = await client.ai.getCallDetail(records[0].id);
    return { summary: `id=${r.id ?? r?.data?.id}`, response: r };
  });

  await test('ai.getCallStats', async () => {
    const r = await client.ai.getCallStats({ groupBy: 'model' });
    const stats = r?.data ?? [];
    return { summary: `${stats.length} groups`, response: r };
  });

  // ════════════════════════════════════════════════════════
  // 9. Error Handling
  // ════════════════════════════════════════════════════════
  section('9. Error Handling');

  await test('invalid RPC method → error', async () => {
    try {
      await client.call('eth', 'mainnet', 'eth_invalidMethod_12345');
      throw new Error('should have thrown');
    } catch (e) {
      if (e.message === 'should have thrown') throw e;
      return { summary: `caught ${e.constructor.name} [${e.code}]` };
    }
  });

  await test('invalid model → AiModelNotFoundError', async () => {
    try {
      await client.chat('nonexistent-model-xyz-999', {
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 8,
      });
      throw new Error('should have thrown');
    } catch (e) {
      if (e.message === 'should have thrown') throw e;
      return { summary: `caught ${e.constructor.name} [${e.code}]` };
    }
  });

  await test('invalid forward path → error', async () => {
    try {
      await client.forward('://bad');
      throw new Error('should have thrown');
    } catch (e) {
      if (e.message === 'should have thrown') throw e;
      return { summary: `caught ${e.constructor.name} [${e.code}]` };
    }
  });

  // ════════════════════════════════════════════════════════
  // 10. Cleanup
  // ════════════════════════════════════════════════════════
  section('10. Final Balance & Cleanup');

  await test('final balance', async () => {
    const r = await client.getBalance();
    return { summary: `balance=${r.balance}, consumed=${r.totalConsumed}`, response: r };
  });

  await test('destroy', async () => {
    client.destroy();
    if (client.getToken()) throw new Error('token not cleared');
    return { summary: 'session cleared' };
  });

  // ════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Total: ${total}  ✅ ${passed}  ❌ ${failed}  ⏭️  ${skipped}`);
  console.log(`${'═'.repeat(50)}\n`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(`\n💥 Fatal: ${err.message}`);
  process.exit(1);
});
