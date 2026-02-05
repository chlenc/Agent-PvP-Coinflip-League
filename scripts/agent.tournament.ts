/*
Tournament runner: 10 distinct agents (players) participate, producing 10 matches.

Optimized to avoid RPC rate limits:
- Creates 10 player keypairs once
- Creates ATAs once
- Funds each player once with enough MALTCOIN for multiple matches
- Runs 10 matches with rotating pairs

Usage:
  cd apps/web
  NEXT_PUBLIC_SOLANA_CLUSTER=testnet \
  NEXT_PUBLIC_MALTCOIN_MINT=... \
  NEXT_PUBLIC_ESCROW_OWNER=... \
  SOLANA_AUTHORITY_KEYPAIR=../../secrets/maltcoin-testnet-authority.json \
  tsx ../../scripts/agent.tournament.ts http://127.0.0.1:3007
*/

import fs from 'node:fs';
import path from 'node:path';
import { Keypair, Connection, clusterApiUrl, PublicKey, Transaction } from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

function loadKeypair(filePath: string): Keypair {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, tries = 10): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const msg = String(e?.message ?? e);
      const is429 = msg.includes('429') || msg.toLowerCase().includes('too many requests') || msg.toLowerCase().includes('rate');
      const delay = Math.min(20_000, 750 * Math.pow(2, i));
      if (!is429 || i === tries - 1) throw e;
      await sleep(delay);
    }
  }
  throw last;
}

async function http<T>(base: string, p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(base + p, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${p}: ${text}`);
  return JSON.parse(text);
}

async function postDepositWithRetry(
  baseUrl: string,
  matchId: string,
  role: 'creator' | 'joiner',
  tx: string,
  tries = 12
) {
  for (let i = 0; i < tries; i++) {
    try {
      return await http<any>(baseUrl, `/api/matches/${matchId}/deposit`, {
        method: 'POST',
        body: JSON.stringify({ role, tx }),
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes('deposit_tx_invalid') && msg.includes('tx_not_found') && i < tries - 1) {
        await sleep(1000 + i * 250);
        continue;
      }
      throw e;
    }
  }
}

async function sendSpl(
  connection: Connection,
  authority: Keypair,
  from: Keypair,
  fromAta: PublicKey,
  toAta: PublicKey,
  amount: bigint
) {
  const tx = new Transaction().add(createTransferInstruction(fromAta, toAta, from.publicKey, amount));
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await withRetry(() => connection.getLatestBlockhash('confirmed'))).blockhash;
  tx.partialSign(authority);
  tx.partialSign(from);
  const sig = await withRetry(() => connection.sendRawTransaction(tx.serialize(), { skipPreflight: false }));
  await withRetry(() => connection.confirmTransaction(sig, 'confirmed'));
  return sig;
}

async function main() {
  const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3007';

  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'testnet';
  const rpcUrl = process.env.SOLANA_RPC_URL ?? clusterApiUrl(cluster as any);
  const connection = new Connection(rpcUrl, 'confirmed');

  const mint = process.env.NEXT_PUBLIC_MALTCOIN_MINT;
  const escrowOwner = process.env.NEXT_PUBLIC_ESCROW_OWNER;
  if (!mint) throw new Error('NEXT_PUBLIC_MALTCOIN_MINT missing');
  if (!escrowOwner) throw new Error('NEXT_PUBLIC_ESCROW_OWNER missing');

  const stake = 1;
  const numPlayers = 10;
  const numMatches = 10;

  const authorityPath =
    process.env.SOLANA_AUTHORITY_KEYPAIR ?? path.resolve(process.cwd(), '../../secrets/maltcoin-testnet-authority.json');
  const authority = loadKeypair(authorityPath);

  const mintPk = new PublicKey(mint);
  const escrowOwnerPk = new PublicKey(escrowOwner);
  const escrowAta = await getAssociatedTokenAddress(mintPk, escrowOwnerPk);

  console.log('RPC:', rpcUrl);
  console.log('MINT:', mintPk.toBase58());
  console.log('ESCROW_ATA:', escrowAta.toBase58());
  console.log('PLAYERS:', numPlayers);
  console.log('MATCHES:', numMatches);

  // Prepare players
  const players = Array.from({ length: numPlayers }, () => Keypair.generate());

  // Create ATAs once
  const authAta = await withRetry(() => getOrCreateAssociatedTokenAccount(connection, authority, mintPk, authority.publicKey));
  const playerAtas: PublicKey[] = [];
  for (const p of players) {
    const ata = await withRetry(() => getOrCreateAssociatedTokenAccount(connection, authority, mintPk, p.publicKey));
    playerAtas.push(ata.address);
    await sleep(250);
  }

  // Fund each player once (enough for multiple games)
  const fundEach = BigInt(stake * 6); // 6 deposits capacity
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const sig = await sendSpl(connection, authority, authority, authAta.address, playerAtas[i], fundEach);
    console.log(`fund[${i}]`, p.publicKey.toBase58(), sig);
    await sleep(400);
  }

  const results: any[] = [];

  // schedule pairs, rotate
  for (let m = 0; m < numMatches; m++) {
    const a = m % numPlayers;
    const b = (m + 1) % numPlayers;

    const creator = players[a];
    const joiner = players[b];

    const created = await http<any>(baseUrl, '/api/matches', {
      method: 'POST',
      body: JSON.stringify({ mint, stake, creatorPubkey: creator.publicKey.toBase58() }),
    });
    const matchId = created.match.id as string;

    const creatorDeposit = await sendSpl(connection, authority, creator, playerAtas[a], escrowAta, BigInt(stake));
    await postDepositWithRetry(baseUrl, matchId, 'creator', creatorDeposit);

    await http<any>(baseUrl, `/api/matches/${matchId}/join`, {
      method: 'POST',
      body: JSON.stringify({ joinerPubkey: joiner.publicKey.toBase58() }),
    });

    const joinerDeposit = await sendSpl(connection, authority, joiner, playerAtas[b], escrowAta, BigInt(stake));
    await postDepositWithRetry(baseUrl, matchId, 'joiner', joinerDeposit);

    const settled = await http<any>(baseUrl, `/api/matches/${matchId}/settle`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const paid = await http<any>(baseUrl, `/api/matches/${matchId}/payout`, {
      method: 'POST',
      body: JSON.stringify({ rpcUrl }),
    });

    const row = {
      matchId,
      players: {
        creator: creator.publicKey.toBase58(),
        joiner: joiner.publicKey.toBase58(),
      },
      tx: {
        creatorDeposit,
        joinerDeposit,
        payout: paid.tx,
      },
      winnerPubkey: settled.match.winnerPubkey,
      flip: settled.match.serverFlip,
      status: paid.match.status,
    };

    results.push(row);
    console.log(`[${m + 1}/${numMatches}] match=${matchId} winner=${row.winnerPubkey} payout=${row.tx.payout}`);
    await sleep(1500);
  }

  const outPath = `./tournament-run-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify({ baseUrl, rpcUrl, mint, escrowOwner, stake, players: players.map((p) => p.publicKey.toBase58()), results }, null, 2));
  console.log('saved:', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
