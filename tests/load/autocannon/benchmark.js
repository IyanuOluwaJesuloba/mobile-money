const autocannon = require('autocannon');
const path = require('path');
const fs = require('fs');

async function runBenchmark(url, options = {}) {
  const result = await autocannon({
    url,
    connections: options.connections || 10,
    duration: options.duration || 10,
    ...options
  });
  return result;
}

/**
 * Format benchmark results as a Markdown comparison table.
 * @param {Array} results - Array of benchmark result objects
 * @returns {string} Markdown-formatted table string
 */
function formatMarkdownTable(results) {
  if (!results.length) return 'No benchmark results to display.';

  const headers = Object.keys(results[0]);
  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;

  const dataRows = results.map(row => {
    const values = headers.map(h => {
      const val = row[h];
      if (typeof val === 'number') {
        return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
      }
      return val;
    });
    return `| ${values.join(' | ')} |`;
  });

  return [headerRow, separatorRow, ...dataRows].join('\n');
}

/**
 * Format a timestamp for display.
 */
function formatTimestamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  console.log(`Starting benchmarks against: ${baseUrl}`);
  console.log(`Timestamp: ${formatTimestamp()}\n`);

  const scenarios = [
    { name: 'Health Check (Baseline)', path: '/health', connections: 50, duration: 10 },
    { name: 'Ready Readiness (DB Check)', path: '/ready', connections: 20, duration: 10 },
    { name: 'Transaction History (Read)', path: '/api/transactions', connections: 10, duration: 10 },
    { name: 'Reports (Heavy Read)', path: '/api/reports', connections: 5, duration: 10 },
  ];

  const results = [];

  for (const scenario of scenarios) {
    console.log(`\n--- Running Bench: ${scenario.name} ---`);
    const res = await runBenchmark(`${baseUrl}${scenario.path}`, {
      connections: scenario.connections,
      duration: scenario.duration,
    });
    
    results.push({
      Scenario: scenario.name,
      'RPS (avg)': res.requests.average,
      'RPS (total)': res.requests.total,
      'Latency p50 (ms)': res.latency.p50,
      'Latency p95 (ms)': res.latency.p95,
      'Latency p99 (ms)': res.latency.p99,
      Errors: res.errors,
      Timeouts: res.timeouts,
    });
    
    console.log(autocannon.printResult(res));
  }

  // Generate Markdown table
  const markdownTable = formatMarkdownTable(results);
  const markdownReport = `# Benchmark Results

**Date:** ${formatTimestamp()}  
**Target:** ${baseUrl}

## Summary

${markdownTable}

## Methodology

- Tool: [autocannon](https://github.com/mcollina/autocannon)
- Each scenario runs for 10 seconds
- Connection counts vary by endpoint complexity

---
*Generated automatically by benchmark.js*
`;

  // Write summary to JSON for programmatic use
  const jsonPath = path.join(__dirname, 'last_benchmark_result.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\nJSON results saved to: ${jsonPath}`);

  // Write Markdown report for human readability
  const mdPath = path.join(__dirname, 'last_benchmark_result.md');
  fs.writeFileSync(mdPath, markdownReport);
  console.log(`Markdown report saved to: ${mdPath}`);

  // Print the table to console as well
  console.log('\n## Benchmark Comparison Table\n');
  console.log(markdownTable);
}

main().catch(console.error);
