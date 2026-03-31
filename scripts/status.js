#!/usr/bin/env node

/**
 * Status Dashboard - Quick system health check
 *
 * Usage: node scripts/status.js
 *
 * Shows comprehensive system status including:
 * - Gateway connectivity
 * - Current balance and usage
 * - Network status
 * - Recent activity
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

function execJson(command) {
  try {
    const result = execSync(command, { encoding: 'utf8' });
    return JSON.parse(result);
  } catch (error) {
    return { error: error.message };
  }
}

function main() {
  console.log('🎯 x402 Gateway Status Dashboard');
  console.log('=' .repeat(40));

  // Check gateway connectivity
  console.log('\n🔗 Gateway Connectivity');
  const gatewayUrl = process.env.X402_GATEWAY_URL || 'http://localhost:4021';
  console.log(`   URL: ${gatewayUrl}`);

  try {
    const health = execJson('node scripts/get-balance.js');
    if (health.error) {
      console.log('   ❌ Gateway unreachable');
      console.log(`   Error: ${health.error}`);
    } else {
      console.log('   ✅ Gateway connected');
    }
  } catch (error) {
    console.log('   ❌ Gateway unreachable');
  }

  // Balance and usage
  console.log('\n💰 Account Status');
  const balance = execJson('node scripts/get-balance.js');
  if (!balance.error) {
    console.log(`   Wallet: ${balance.wallet}`);
    console.log(`   Balance: ${balance.balance.toLocaleString()} credits`);
    console.log(`   Tier: ${balance.tier}`);
    console.log(`   Purchased: ${balance.totalPurchased.toLocaleString()}`);
    console.log(`   Consumed: ${balance.totalConsumed.toLocaleString()}`);
  } else {
    console.log(`   ❌ Cannot fetch balance: ${balance.error}`);
  }

  // Usage statistics
  console.log('\n📊 Recent Usage');
  const usage = execJson('node scripts/get-usage.js');
  if (!usage.error) {
    console.log(`   Total calls: ${usage.totalCalls || 0}`);
    console.log(`   Credits used: ${usage.totalCredits || 0}`);
    console.log(`   Last activity: ${usage.lastActivity || 'N/A'}`);
  } else {
    console.log('   ❌ Usage data unavailable');
  }

  // Network information
  console.log('\n🌐 Network Information');
  console.log('   Available networks:');
  console.log('   • Ethereum (eth)');
  console.log('   • Base (base)');
  console.log('   • Solana (solana)');

  // Quick actions
  console.log('\n⚡ Quick Actions');
  console.log('   • node scripts/quick-start.js       - Setup wizard');
  console.log('   • node scripts/estimate-cost.js     - Cost calculator');
  console.log('   • node scripts/purchase-credits.js  - Buy credits');
  console.log('   • node scripts/status.js            - This dashboard');
}

main();