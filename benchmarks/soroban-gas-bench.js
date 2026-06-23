#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const wasmPath = path.resolve(repoRoot, 'contracts', 'target', 'wasm32v1-none', 'release', 'escrow.wasm');
const methods = ['initialize', 'release', 'refund', 'emergency_refund', 'get_state'];
const networkName = process.env.SOROBAN_NETWORK || 'local';
const rpcUrl = process.env.SOROBAN_RPC_URL || '';
const secretKey = process.env.SOROBAN_SECRET_KEY || '';

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args, options = {}) {
  const cmd = [command, ...args].join(' ');
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...options });
}

function buildEscrowWasm() {
  if (fs.existsSync(wasmPath)) {
    console.log('✅ Escrow WASM already built:', wasmPath);
    return;
  }

  if (!commandExists('cargo')) {
    throw new Error(
      'Cargo is required to build the Escrow contract, but it was not found in PATH. Install Rust/Cargo or prebuild the contract via scripts/check-wasm.sh.'
    );
  }

  console.log('🔨 Building Escrow contract WASM...');
  runCommand('bash', ['scripts/check-wasm.sh'], { cwd: repoRoot });

  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Expected WASM at ${wasmPath} after build, but it was not found.`);
  }

  const sizeKb = (fs.statSync(wasmPath).size / 1024).toFixed(1);
  console.log(`✅ Built escrow.wasm (${sizeKb} KB)`);
}

function reportWasmSize() {
  if (!fs.existsSync(wasmPath)) {
    console.log('⚠️  Escrow WASM not found. Run with cargo installed or build manually with scripts/check-wasm.sh.');
    return;
  }

  const size = fs.statSync(wasmPath).size;
  const sizeKb = (size / 1024).toFixed(1);
  console.log(`📦 Escrow WASM size: ${size} bytes (${sizeKb} KB)`);
}

function printHelp() {
  console.log('Usage: node benchmarks/soroban-gas-bench.js');
  console.log('Environment variables:');
  console.log('  SOROBAN_NETWORK    - soroban network name (default: local)');
  console.log('  SOROBAN_RPC_URL    - soroban RPC URL (optional, overrides network)');
  console.log('  SOROBAN_SECRET_KEY - private key for invoking contract methods');
  console.log('  SKIP_BUILD         - set to 1 to skip wasm build step');
}

function runSorobanCliBenchmark() {
  if (!commandExists('soroban')) {
    console.log('⚠️  Soroban CLI is not installed. Skipping runtime gas benchmark.');
    console.log('   Install the Soroban CLI and run this script again to collect gas metrics.');
    return;
  }

  if (!secretKey) {
    console.log('⚠️  Environment variable SOROBAN_SECRET_KEY is required for contract invocation.');
    console.log('   Set SOROBAN_SECRET_KEY to a valid Soroban account secret and rerun the benchmark.');
    return;
  }

  console.log(`🌐 Using Soroban network: ${networkName}`);
  if (rpcUrl) {
    console.log(`🔌 RPC URL: ${rpcUrl}`);
  }

  try {
    console.log('🚀 Starting Soroban gas benchmark flow...');

    const deployArgs = ['contract', 'deploy', '--wasm', wasmPath];
    if (rpcUrl) {
      deployArgs.push('--rpc-url', rpcUrl);
    } else {
      deployArgs.push('--network', networkName);
    }

    const deployOutput = runCommand('soroban', deployArgs, { cwd: repoRoot });
    const idMatch = deployOutput.match(/(GC[0-9A-Z]{55}|[A-Z0-9]{56})/);
    if (!idMatch) {
      throw new Error('Failed to parse contract ID from Soroban deploy output.');
    }
    const contractId = idMatch[0];
    console.log(`✅ Deployed Escrow contract id: ${contractId}`);

    const results = {};
    for (const method of methods) {
      console.log(`\n▶ Measuring gas for method: ${method}`);
      const args = method === 'initialize'
        ? [
            '--func', 'initialize',
            '--args',
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAL7NV',
            'GAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA33',
            'GAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA44',
            contractId,
            '500000',
            '1000',
          ]
        : ['--func', method];

      const invokeArgs = [
        'contract',
        'invoke',
        '--id',
        contractId,
        '--wasm',
        wasmPath,
        '--secret-key',
        secretKey,
        ...args,
      ];
      if (rpcUrl) {
        invokeArgs.push('--rpc-url', rpcUrl);
      } else {
        invokeArgs.push('--network', networkName);
      }

      const output = runCommand('soroban', invokeArgs, { cwd: repoRoot });
      const gasMatch = output.match(/gas(?:Used|Consumed)[:=]\s*(\d+)/i);
      results[method] = gasMatch ? Number(gasMatch[1]) : null;
      console.log(`  ${method}: ${results[method] ?? 'gas data unavailable'}`);
    }

    console.log('\n📊 Soroban Escrow Gas Benchmark Results');
    methods.forEach((method) => {
      console.log(`  - ${method}: ${results[method] ?? 'unavailable'}`);
    });
  } catch (error) {
    console.error('❌ Soroban CLI benchmark failed:', error.message || error);
    console.log('Please ensure the Soroban CLI supports `contract deploy` and `contract invoke` for your version.');
  }
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  if (process.env.SKIP_BUILD !== '1') {
    try {
      buildEscrowWasm();
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }

  reportWasmSize();
  runSorobanCliBenchmark();
}

main();
