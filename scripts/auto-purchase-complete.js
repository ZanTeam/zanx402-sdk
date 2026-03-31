#!/usr/bin/env node

/**
 * Auto Purchase and Execute - Complete automated payment flow
 *
 * Usage: node scripts/auto-purchase-complete.js [bundle]
 *
 * Automatically purchases credits and makes RPC calls in one step
 * Requires manual wallet approval for the payment transaction
 */

import { X402Client } from '../dist/esm/index.js';

const GATEWAY_URL = process.env.X402_GATEWAY_URL || 'http://localhost:4021';
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
const BUNDLE = process.argv[2] || 'default';

if (!PRIVATE_KEY) {
  console.error(JSON.stringify({ error: 'EVM_PRIVATE_KEY environment variable is required' }));
  process.exit(1);
}

async function main() {
  console.log('🚀 Auto Purchase & Execute Flow');
  console.log('=' .repeat(40));

  try {
    const client = new X402Client({
      gatewayUrl: GATEWAY_URL,
      privateKey: PRIVATE_KEY,
      chainType: 'EVM',
      autoPayment: true,
      defaultBundle: BUNDLE,
    });

    console.log('\n💰 Checking current balance...');
    const balance = await client.getBalance();
    console.log(`   Current: ${balance.balance} credits`);

    if (balance.balance < 1000) {
      console.log('\n🛒 Purchasing credits...');
      const purchase = await client.purchaseCredits(BUNDLE);

      if (purchase.success) {
        console.log(`✅ Purchased: ${purchase.creditsPurchased} credits`);
        console.log(`   Transaction: ${purchase.txHash}`);
        console.log(`   New balance: ${purchase.balance} credits`);
      } else {
        console.log('❌ Purchase failed:', purchase.message);
        return;
      }
    }

    console.log('\n🔗 Making test RPC call...');
    const result = await client.call('eth', 'mainnet', 'eth_blockNumber');
    console.log(`✅ Latest block: ${parseInt(result.result, 16)}`);

    const newBalance = await client.getBalance();
    console.log(`   Remaining: ${newBalance.balance} credits`);

  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.code === 'INSUFFICIENT_CREDITS') {
      console.log('\n💡 Suggestion: Check your wallet balance or use testnet');
      console.log('   Ensure your wallet has sufficient USDC on the payment network.');
    }
  }
}

main();