#!/usr/bin/env node

/**
 * Testnet Faucet - Get Testnet tokens for development
 *
 * Usage: node scripts/testnet-faucet.js <network>
 *
 * Networks: sepolia, base-sepolia, solana-devnet
 */

const FAUCET_URLS = {
  'sepolia': 'https://sepoliafaucet.com',
  'base-sepolia': 'https://basescan.org/faucet',
  'solana-devnet': 'https://faucet.solana.com'
};

function main() {
  const [network] = process.argv.slice(2);

  if (!network) {
    console.log('🚰 Testnet Faucet Guide');
    console.log('=' .repeat(30));
    console.log('\nAvailable testnets:');

    Object.entries(FAUCET_URLS).forEach(([net, url]) => {
      console.log(`  ${net}: ${url}`);
    });

    console.log('\nUsage: node scripts/testnet-faucet.js <network>');
    console.log('\nExample:');
    console.log('  node scripts/testnet-faucet.js sepolia');

    console.log('\n💡 Tips:');
    console.log('  • Use testnet for development/testing');
    console.log('  • Get testnet tokens from the faucets above');
    console.log('  • Configure your wallet for the testnet network');
    console.log('  • Testnet credits are free but have limited availability');

    return;
  }

  const faucetUrl = FAUCET_URLS[network];
  if (!faucetUrl) {
    console.log(`❌ Network ${network} not supported`);
    console.log('Use: sepolia, base-sepolia, or solana-devnet');
    return;
  }

  console.log(`🚰 Testnet faucet for ${network}:`);
  console.log(`   URL: ${faucetUrl}`);
  console.log(`\n📋 Steps:`);
  console.log(`   1. Visit: ${faucetUrl}`);
  console.log(`   2. Connect your wallet`);
  console.log(`   3. Request testnet tokens`);
  console.log(`   4. Wait for confirmation`);
  console.log(`   5. Configure gateway for ${network}`);

  // Show example configuration
  console.log('\n🔧 Example config for testnet:');
  if (network.includes('sepolia')) {
    console.log('   X402_GATEWAY_URL=http://localhost:4021');
    console.log('   EVM_PRIVATE_KEY=your_testnet_private_key');
    console.log('   NETWORK=sepolia');
  } else if (network === 'solana-devnet') {
    console.log('   X402_GATEWAY_URL=http://localhost:4021');
    console.log('   SOLANA_PRIVATE_KEY=your_devnet_private_key');
    console.log('   NETWORK=solana-devnet');
  }
}

main();