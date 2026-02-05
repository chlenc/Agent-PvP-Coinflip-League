/*
Run multiple autonomous matches ("10 agents played").

Each run generates fresh creator/joiner keypairs (so effectively 20 distinct agents/players)
and executes a full match lifecycle via API + on-chain.

Usage:
  cd apps/web
  NEXT_PUBLIC_SOLANA_CLUSTER=testnet \
  NEXT_PUBLIC_MALTCOIN_MINT=... \
  NEXT_PUBLIC_ESCROW_OWNER=... \
  SOLANA_AUTHORITY_KEYPAIR=../../secrets/maltcoin-testnet-authority.json \
  tsx ../../scripts/agent.league.ts http://127.0.0.1:3007 10
*/

import { runMoltflipMatch } from './agent.sdk';
import fs from 'node:fs';

async function main() {
  const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3007';
  const n = Number(process.argv[3] ?? '10');
  if (!Number.isFinite(n) || n <= 0) throw new Error('N must be positive');

  const results: any[] = [];
  const startedAt = new Date().toISOString();

  for (let i = 0; i < n; i++) {
    const r = await runMoltflipMatch(baseUrl);
    results.push(r);
    console.log(`[${i + 1}/${n}] match=${r.matchId} winner=${r.winnerPubkey} payout=${r.tx.payout}`);
    // avoid RPC rate limits on public testnet endpoint
    await new Promise((res) => setTimeout(res, 1500));
  }

  const endedAt = new Date().toISOString();
  const out = {
    startedAt,
    endedAt,
    baseUrl,
    n,
    results,
  };

  const outPath = `./league-run-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('saved:', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
