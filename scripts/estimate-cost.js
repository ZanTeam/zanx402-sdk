#!/usr/bin/env node

/**
 * Cost Estimator - Preview API call costs
 *
 * Usage: node scripts/estimate-cost.js <ecosystem> <method>
 *
 * Examples:
 *   node scripts/estimate-cost.js eth eth_blockNumber
 *   node scripts/estimate-cost.js solana getSlot
 */

const COST_MAP = {
  eth: {
    'eth_blockNumber': 1,
    'eth_getBalance': 2,
    'eth_getBlockByNumber': 3,
    'eth_call': 5,
    'eth_getTransactionReceipt': 2,
    'eth_gasPrice': 1,
    'eth_estimateGas': 5
  },
  solana: {
    'getSlot': 1,
    'getBalance': 2,
    'getTransaction': 3,
    'getAccountInfo': 2,
    'getBlockHeight': 1
  },
  base: {
    'eth_blockNumber': 1,
    'eth_getBalance': 2,
    'eth_call': 5
  }
};

function main() {
  const [ecosystem, method] = process.argv.slice(2);

  if (!ecosystem || !method) {
    console.log('Usage: node scripts/estimate-cost.js <ecosystem> <method>');
    console.log('\nSupported ecosystems: eth, solana, base');
    console.log('\nExample costs:');

    Object.entries(COST_MAP).forEach(([eco, methods]) => {
      console.log(`\n${eco.toUpperCase()}:`);
      Object.entries(methods).forEach(([m, cost]) => {
        console.log(`  ${m}: ${cost} credit${cost !== 1 ? 's' : ''}`);
      });
    });
    process.exit(1);
  }

  const cost = COST_MAP[ecosystem]?.[method];
  if (cost === undefined) {
    console.log(`❌ Method ${method} not found for ${ecosystem}`);
    console.log('\nAvailable methods:');
    Object.entries(COST_MAP[ecosystem] || {}).forEach(([m, c]) => {
      console.log(`  ${m}: ${c} credit${c !== 1 ? 's' : ''}`);
    });
    process.exit(1);
  }

  console.log(`💰 Cost estimate for ${ecosystem}.${method}:`);
  console.log(`   Credits: ${cost} credit${cost !== 1 ? 's' : ''}`);
  console.log(`   USD: $${(cost * 0.0001).toFixed(4)}`);
  console.log(`   Calls per $1: ${Math.floor(1 / (cost * 0.0001))}`);
}

main();