#!/usr/bin/env node

/**
 * Compare RAW (OpenAI direct) vs SERV Reasoning endpoint performance and stability.
 * Inspired by https://docs.openserv.ai/serv-reasoning/tutorials/compare-raw-and-serv.md
 */

import process from 'node:process';

// Parse arguments: --runs <N> or --runs=<N> (default 3)
let runs = 3;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--runs' && args[i + 1]) {
    runs = parseInt(args[++i], 10) || 3;
  } else if (args[i].startsWith('--runs=')) {
    runs = parseInt(args[i].slice(7), 10) || 3;
  }
}

const rawConfig = {
  name: 'RAW (OpenAI)',
  baseUrl: (process.env.RAW_API_URL || 'https://api.openai.com').replace(/\/+$/, ''),
  apiKey: process.env.RAW_API_KEY || '',
  model: process.env.RAW_MODEL || 'gpt-4o-mini',
};

const servConfig = {
  name: 'SERV Reasoning',
  baseUrl: (process.env.SERV_REASONING_URL || 'https://inference-api.openserv.ai').replace(/\/+$/, ''),
  apiKey: process.env.SERV_API_KEY || process.env.SERV_REASONING_API_KEY || '',
  model: process.env.SERV_REASONING_MODEL || 'gemini-3.8-flash',
};

if (!rawConfig.apiKey && !servConfig.apiKey) {
  console.log(`=== Compare RAW vs SERV Reasoning Benchmark ===

Both RAW_API_KEY and SERV_API_KEY are missing.

Instructions to set up:
  1. SERV Reasoning (get key from https://console.openserv.ai Settings -> Keys):
     export SERV_API_KEY="serv_..."
     export SERV_REASONING_URL="https://inference-api.openserv.ai" # optional
     export SERV_REASONING_MODEL="gemini-3.8-flash"                   # optional

  2. RAW OpenAI baseline (optional):
     export RAW_API_KEY="sk-..."
     export RAW_API_URL="https://api.openai.com"                 # optional
     export RAW_MODEL="gpt-4o-mini"                              # optional

Usage:
  node scripts/compare-raw-and-serv.mjs [--runs 3]
`);
  process.exit(0);
}

const promptMessages = [
  {
    role: 'system',
    content:
      'You are a software planning agent. Output ONLY a valid JSON object matching this schema: {"intent": string, "steps": string[], "prohibited_actions": string[]}. Do not include markdown codeblocks or explanation.',
  },
  {
    role: 'user',
    content: 'Fix accessibility issues in a React component and open a reviewable change',
  },
];

async function executeRun(config) {
  const url = `${config.baseUrl}/v1/chat/completions`;
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: promptMessages,
        temperature: 0.2,
      }),
    });
    const latency = Math.round(performance.now() - started);
    if (!res.ok) {
      return { ok: false, latency, promptTokens: 0, completionTokens: 0, jsonValid: false, err: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    let jsonValid = false;
    try {
      const parsed = JSON.parse(content.trim());
      if (parsed && typeof parsed.intent === 'string' && Array.isArray(parsed.steps) && Array.isArray(parsed.prohibited_actions)) {
        jsonValid = true;
      }
    } catch {
      jsonValid = false;
    }
    return { ok: true, latency, promptTokens, completionTokens, jsonValid };
  } catch (err) {
    return { ok: false, latency: Math.round(performance.now() - started), promptTokens: 0, completionTokens: 0, jsonValid: false, err: err.message };
  }
}

async function benchmark(config) {
  if (!config.apiKey) return null;
  const results = [];
  process.stdout.write(`Benchmarking ${config.name} (${runs} runs)... `);
  for (let i = 0; i < runs; i++) {
    results.push(await executeRun(config));
    process.stdout.write(`${i + 1} `);
  }
  process.stdout.write('done.\n');

  const totalRuns = results.length;
  const successful = results.filter((r) => r.ok);
  const failures = totalRuns - successful.length;
  const avgLatency = Math.round(results.reduce((acc, r) => acc + r.latency, 0) / totalRuns);
  const totalPromptTokens = results.reduce((acc, r) => acc + r.promptTokens, 0);
  const totalCompletionTokens = results.reduce((acc, r) => acc + r.completionTokens, 0);
  const totalTokens = totalPromptTokens + totalCompletionTokens;
  const validJsonCount = results.filter((r) => r.jsonValid).length;
  const jsonValidRate = `${((validJsonCount / totalRuns) * 100).toFixed(1)}% (${validJsonCount}/${totalRuns})`;

  // Pricing for gpt-4o-mini: $0.15/1M input + $0.60/1M output
  const avgPrompt = totalRuns > 0 ? totalPromptTokens / totalRuns : 0;
  const avgCompletion = totalRuns > 0 ? totalCompletionTokens / totalRuns : 0;
  const costPer1kTasks = (avgPrompt * 0.15 + avgCompletion * 0.60) / 1000;

  return {
    runs: totalRuns,
    avgLatency: `${avgLatency} ms`,
    jsonValidRate,
    failures,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    costPer1k: `$${costPer1kTasks.toFixed(4)}`,
  };
}

console.log(`Starting RAW vs SERV comparison (${runs} runs per active endpoint)...\n`);
if (!rawConfig.apiKey) {
  console.log('[INFO] RAW endpoint skipped (RAW_API_KEY not set). Set RAW_API_KEY="sk-..." to benchmark OpenAI direct.');
}
if (!servConfig.apiKey) {
  console.log('[INFO] SERV endpoint skipped (SERV_API_KEY not set). Set SERV_API_KEY="serv_..." to benchmark SERV Reasoning.');
}

const rawSummary = await benchmark(rawConfig);
const servSummary = await benchmark(servConfig);

function cell(val, placeholder = 'Skipped') {
  return val !== undefined && val !== null ? String(val) : placeholder;
}

console.log(`\n### Benchmark Results (N=${runs})\n`);
console.log('| Metric | RAW (OpenAI) | SERV Reasoning |');
console.log('| :--- | :--- | :--- |');
console.log(`| Model | ${rawConfig.model} | ${servConfig.model} |`);
console.log(`| Configured Endpoint | ${rawConfig.baseUrl} | ${servConfig.baseUrl} |`);
console.log(`| Runs Attempted | ${cell(rawSummary?.runs)} | ${cell(servSummary?.runs)} |`);
console.log(`| Avg Latency | ${cell(rawSummary?.avgLatency)} | ${cell(servSummary?.avgLatency)} |`);
console.log(`| JSON-Valid Rate | ${cell(rawSummary?.jsonValidRate)} | ${cell(servSummary?.jsonValidRate)} |`);
console.log(`| Failures | ${cell(rawSummary?.failures)} | ${cell(servSummary?.failures)} |`);
console.log(`| Total Prompt Tokens | ${cell(rawSummary?.totalPromptTokens)} | ${cell(servSummary?.totalPromptTokens)} |`);
console.log(`| Total Completion Tokens | ${cell(rawSummary?.totalCompletionTokens)} | ${cell(servSummary?.totalCompletionTokens)} |`);
console.log(`| Total Tokens | ${cell(rawSummary?.totalTokens)} | ${cell(servSummary?.totalTokens)} |`);
console.log(`| Est. Cost / 1k Tasks | ${cell(rawSummary?.costPer1k)} | ${cell(servSummary?.costPer1k)} |`);
console.log('\n* Pricing estimated at $0.15/1M input and $0.60/1M output (gpt-4o-mini rate).\n');
