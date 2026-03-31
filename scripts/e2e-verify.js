#!/usr/bin/env node

/**
 * End-to-end verification of the x402 SDK against a local gateway.
 *
 * Usage:
 *   X402_GATEWAY_URL=http://localhost:8080 node scripts/e2e-verify.js
 */

import { X402Client } from '../dist/esm/index.js';
import { generatePrivateKey } from 'viem/accounts';

const GATEWAY = process.env.X402_GATEWAY_URL || 'http://localhost:8080';
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || generatePrivateKey();

const pass = (label) => console.log(`  ✅  ${label}`);
const fail = (label, err) => { console.log(`  ❌  ${label}: ${err?.message ?? err}`); return false; };
const section = (title) => console.log(`\n━━ ${title} ━━`);
let allPassed = true;

async function run() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   x402 SDK End-to-End Verification       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Gateway : ${GATEWAY}`);
  console.log(`  Key     : ${PRIVATE_KEY.slice(0, 10)}...`);

  // ── Step 1: Discovery (public, no auth) ──────────────────
  section('1. Discovery（公开接口，无需认证）');

  const publicClient = new X402Client({ gatewayUrl: GATEWAY, chainType: 'EVM' });

  try {
    const h = await publicClient.health();
    pass(`health → status=${h.status}`);
  } catch (e) { allPassed = fail('health', e); }

  let networkList;
  try {
    const n = await publicClient.listNetworks();
    networkList = n.networks;
    const ecosystemSet = new Set(networkList.map(x => x.ecosystem));
    pass(`networks → ${ecosystemSet.size} ecosystems, ${networkList.length} networks`);
  } catch (e) { allPassed = fail('networks', e); }

  try {
    const b = await publicClient.listBundles();
    pass(`bundles  → ${b.bundles.map(x => x.name).join(', ')}`);
  } catch (e) { allPassed = fail('bundles', e); }

  // ── Step 2: Authentication (SIWE) ────────────────────────
  section('2. Authentication（SIWE 签名认证）');

  const client = new X402Client({
    gatewayUrl: GATEWAY,
    privateKey: PRIVATE_KEY,
    chainType: 'EVM',
    autoPayment: false,
  });

  try {
    const auth = await client.authenticate();
    pass(`authenticate → wallet=${auth.wallet}, tier=${auth.tier}, expiresIn=${auth.expiresIn}s`);
  } catch (e) { allPassed = fail('authenticate', e); }

  // ── Step 3: Balance (should be 0 for new wallet) ─────────
  section('3. Balance（查询余额）');

  let balance;
  try {
    balance = await client.getBalance();
    pass(`balance → ${balance.balance} credits (purchased=${balance.totalPurchased}, consumed=${balance.totalConsumed})`);
  } catch (e) { allPassed = fail('balance', e); }

  // ── Step 4: RPC Calls ────────────────────────────────────
  section('4. RPC Calls（区块链 RPC 调用）');

  if (!balance || balance.balance <= 0) {
    console.log('  ⚠️  余额为 0，尝试用 autoPayment 模式跳过...');
  }

  // 5a. eth_blockNumber (cheapest EVM call)
  try {
    const blockNum = await client.call('eth', 'mainnet', 'eth_blockNumber');
    pass(`eth/mainnet eth_blockNumber → ${blockNum.result}`);
  } catch (e) { allPassed = fail('eth_blockNumber', e); }

  // 5b. eth_chainId
  try {
    const chainId = await client.call('eth', 'mainnet', 'eth_chainId');
    pass(`eth/mainnet eth_chainId → ${chainId.result}`);
  } catch (e) { allPassed = fail('eth_chainId', e); }

  // 5c. eth_gasPrice
  try {
    const gasPrice = await client.call('eth', 'mainnet', 'eth_gasPrice');
    pass(`eth/mainnet eth_gasPrice → ${gasPrice.result}`);
  } catch (e) { allPassed = fail('eth_gasPrice', e); }

  // 5d. eth_getBalance (Vitalik)
  try {
    const bal = await client.call('eth', 'mainnet', 'eth_getBalance', [
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      'latest',
    ]);
    pass(`eth/mainnet eth_getBalance(vitalik) → ${bal.result}`);
  } catch (e) { allPassed = fail('eth_getBalance', e); }

  // 5e. Solana getSlot (if available)
  const hasSolana = networkList && networkList.some(n => n.ecosystem === 'solana');
  if (hasSolana) {
    try {
      const slot = await client.call('solana', 'mainnet', 'getSlot');
      pass(`solana/mainnet getSlot → ${slot.result}`);
    } catch (e) { allPassed = fail('solana getSlot', e); }
  }

  // 5f. Batch RPC call
  try {
    const batchResults = await client.rpc.batch('eth', 'mainnet', [
      { method: 'eth_blockNumber' },
      { method: 'eth_chainId' },
      { method: 'net_version' },
    ]);
    pass(`eth/mainnet batch(3 methods) → [${batchResults.map(r => r.result).join(', ')}]`);
  } catch (e) { allPassed = fail('batch RPC', e); }

  // ── Step 6: Fetch API wrapper ────────────────────────────
  section('6. Fetch API（透明代理模式）');

  try {
    const res = await client.fetch('/rpc/eth/mainnet', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'eth_blockNumber',
        params: [],
      }),
    });
    const data = await res.json();
    pass(`fetch('/rpc/eth/mainnet') → status=${res.status}, result=${data.result}`);
  } catch (e) { allPassed = fail('fetch API', e); }

  // ── Step 7: Usage ────────────────────────────────────────
  section('7. Usage（使用记录查询）');

  try {
    const usage = await client.getUsage();
    pass(`usage → ${usage.records?.length ?? 0} records in current page`);
  } catch (e) { allPassed = fail('usage', e); }

  // ── Step 8: Final balance ────────────────────────────────
  section('8. Final Balance（最终余额）');

  try {
    const finalBal = await client.getBalance();
    pass(`final balance → ${finalBal.balance} credits (consumed=${finalBal.totalConsumed})`);
  } catch (e) { allPassed = fail('final balance', e); }

  // ── Summary ──────────────────────────────────────────────
  console.log('\n' + '═'.repeat(44));
  if (allPassed) {
    console.log('  🎉  All checks passed!');
  } else {
    console.log('  ⚠️  Some checks failed — see above.');
  }
  console.log('═'.repeat(44));
}

run().catch((err) => {
  console.error('\n💥 Fatal error:', err);
  process.exit(1);
});
