#!/usr/bin/env node

/**
 * Help Command - Comprehensive command guide
 *
 * Usage: node scripts/help.js [command]
 */

const COMMANDS = {
  'quick-start': 'Interactive setup wizard for new users',
  'status': 'Show system health and current status',
  'get-balance': 'Check your current credit balance',
  'get-usage': 'View your usage statistics',
  'estimate-cost': 'Calculate API call costs before making them',
  'purchase-credits': 'Buy credit bundles',
  'rpc-call': 'Make blockchain RPC calls',
  'list-networks': 'Show available networks',
  'authenticate': 'Authenticate with your wallet'
};

function main() {
  const [command] = process.argv.slice(2);

  if (command && COMMANDS[command]) {
    console.log(`📋 ${command} - ${COMMANDS[command]}`);

    // Show specific help for command
    switch (command) {
      case 'rpc-call':
        console.log('\nUsage:');
        console.log('  node scripts/rpc-call.js <ecosystem> <network> <method> [params]');
        console.log('\nExamples:');
        console.log('  node scripts/rpc-call.js eth mainnet eth_blockNumber');
        console.log('  node scripts/rpc-call.js solana mainnet getSlot');
        console.log('  node scripts/rpc-call.js eth mainnet eth_getBalance \'["0x...","latest"]\'');
        break;
      case 'purchase-credits':
        console.log('\nUsage:');
        console.log('  node scripts/purchase-credits.js [bundle]');
        console.log('\nBundles:');
        console.log('  default  - Default micro-payment bundle (current enabled option)');
        break;
      default:
        console.log('\nRun the command without arguments to see usage details.');
    }
  } else {
    console.log('🎯 x402 Gateway Command Reference');
    console.log('=' .repeat(40));
    console.log('\nAvailable commands:');

    Object.entries(COMMANDS).forEach(([cmd, desc]) => {
      console.log(`  ${cmd.padEnd(18)} - ${desc}`);
    });

    console.log('\n📋 Getting Started:');
    console.log('  1. node scripts/quick-start.js     # Interactive setup');
    console.log('  2. node scripts/status.js         # Check system status');
    console.log('  3. node scripts/estimate-cost.js  # Preview costs');
    console.log('  4. node scripts/rpc-call.js ...   # Make API calls');

    console.log('\n💡 Pro Tips:');
    console.log('  • Check status.js regularly for balance');
    console.log('  • Use estimate-cost.js before expensive calls');
    console.log('  • Set environment variables in .env file');

    console.log('\n🔗 Environment Variables:');
    console.log('  X402_GATEWAY_URL   - Gateway endpoint');
    console.log('  EVM_PRIVATE_KEY    - Ethereum private key');
    console.log('  SOLANA_PRIVATE_KEY - Solana private key');
    console.log('  X402_AUTO_PAYMENT  - Auto-purchase credits (true/false)');
  }
}

main();