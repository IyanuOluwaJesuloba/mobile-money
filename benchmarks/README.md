# Soroban Gas Benchmark

This benchmark measures Soroban gas usage for the Escrow contract methods.

## Purpose

- Build the `contracts/escrow` Soroban contract.
- Deploy it locally through the Soroban CLI.
- Invoke common contract methods.
- Parse and report gas usage for each method.

## Usage

1. Build the Escrow contract:

```bash
npm run contracts:build
```

2. Run the benchmark:

```bash
npm run bench:soroban-gas
```

3. Optional environment variables:

- `SOROBAN_NETWORK` - Soroban network name, default is `local`.
- `SOROBAN_RPC_URL` - RPC URL to use instead of a named network.
- `SOROBAN_SECRET_KEY` - Secret key used to invoke contract methods.
- `SKIP_BUILD=1` - Skip WASM build if the contract is already compiled.

## Notes

- The script requires the Soroban CLI installed and available in `PATH`.
- If the CLI is unavailable, the script will still emit the current WASM size and instructions.
- `soroban` output must include gas metrics for the script to parse them correctly.
