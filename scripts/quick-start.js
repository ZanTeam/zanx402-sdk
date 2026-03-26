#!/usr/bin/env node

/**
 * Quick Start Guide - Interactive x402 Gateway Setup
 *
 * Usage: node scripts/quick-start.js
 *
 * Provides interactive setup wizard for new users
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const CONFIG_DIR = path.join(homedir(), '.x402');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

async function main() {
  console.log('🚀 x402 Gateway Quick Start Wizard');
  console.log('='.repeat(40));

  // Check if already configured
  if (existsSync(CONFIG_FILE)) {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    console.log('✅ Already configured!');
    console.log(`Gateway: ${config.gatewayUrl}`);
    console.log(`Wallet: ${config.walletAddress}`);
    console.log(`Network: ${config.network}`);
    return;
  }

  console.log('\n📋 Step 1: Environment Setup');
  console.log('This wizard will help you:');
  console.log('  • Set up your wallet securely');
  console.log('  • Configure the gateway');
  console.log('  • Test your connection');
  console.log('  • Show your current balance');

  // Create config directory
  if (!existsSync(CONFIG_DIR)) {
    execSync(`mkdir -p ${CONFIG_DIR}`);
  }

  // Interactive setup
  const readline = (await import('readline')).createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (question) => new Promise(resolve => readline.question(question, resolve));

  const gatewayUrl = await ask('\n🌐 Gateway URL (default: http://localhost:4021): ') || 'http://localhost:4021';
  const privateKey = await ask('🔑 Private Key (0x...): ');
  const network = await ask('🌐 Network (ethereum/base/solana, default: ethereum): ') || 'ethereum';

  readline.close();

  // Save configuration
  const config = {
    gatewayUrl,
    privateKey,
    network,
    walletAddress: '0x' + privateKey.slice(-40),
    createdAt: new Date().toISOString()
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  // Set environment variables
  process.env.X402_GATEWAY_URL = gatewayUrl;
  process.env.EVM_PRIVATE_KEY = privateKey;

  console.log('\n✅ Configuration saved!');
  console.log(`Config file: ${CONFIG_FILE}`);

  // Test connection and show balance
  console.log('\n🧪 Testing connection...');
  try {
    const balance = execSync('node scripts/get-balance.js', { encoding: 'utf8' });
    const balanceData = JSON.parse(balance);
    console.log(`💰 Current balance: ${balanceData.balance} credits`);
    console.log(`📊 Tier: ${balanceData.tier}`);
  } catch (error) {
    console.log('⚠️  Gateway not accessible - check if server is running');
  }

  console.log('\n🎯 Next steps:');
  console.log('  • Run: node scripts/purchase-credits.js default');
  console.log('  • Test: node scripts/rpc-call.js eth mainnet eth_blockNumber');
  console.log('  • Check: node scripts/get-usage.js');
}

main().catch(console.error);