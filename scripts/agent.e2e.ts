/*
E2E agent runner (API-first).
- Generates 2 ephemeral player keypairs.
- Authority (server keypair) acts as fee payer and funds players with MALTCOIN.
- Runs: create match -> creator deposit -> join -> joiner deposit -> settle -> payout.

Usage:
  cd apps/web
  NEXT_PUBLIC_SOLANA_CLUSTER=testnet \
  NEXT_PUBLIC_MALTCOIN_MINT=... \
  NEXT_PUBLIC_ESCROW_OWNER=... \
  SOLANA_AUTHORITY_KEYPAIR=../../secrets/maltcoin-testnet-authority.json \
  tsx ../../scripts/agent.e2e.ts http://127.0.0.1:3007
*/

import fs from 'node:fs';
import path from 'node:path';
import { Keypair, Connection, clusterApiUrl, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
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

async function http<T>(base: string, p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(base + p, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${p}: ${text}`);
  return JSON.parse(text);
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

  const authorityPath =
    process.env.SOLANA_AUTHORITY_KEYPAIR ?? path.resolve(process.cwd(), '../../secrets/maltcoin-testnet-authority.json');
  const authority = loadKeypair(authorityPath);

  const creator = Keypair.generate();
  const joiner = Keypair.generate();

  const mintPk = new PublicKey(mint);
  const escrowOwnerPk = new PublicKey(escrowOwner);
  const escrowAta = await getAssociatedTokenAddress(mintPk, escrowOwnerPk);

  console.log('RPC:', rpcUrl);
  console.log('MINT:', mintPk.toBase58());
  console.log('ESCROW_OWNER:', escrowOwnerPk.toBase58());
  console.log('ESCROW_ATA:', escrowAta.toBase58());
  console.log('AUTHORITY:', authority.publicKey.toBase58());
  console.log('CREATOR:', creator.publicKey.toBase58());
  console.log('JOINER :', joiner.publicKey.toBase58());

  const stake = 1;

  // Fund players with MALTCOIN from authority (authority pays fees)
  const authAta = await getOrCreateAssociatedTokenAccount(connection, authority, mintPk, authority.publicKey);
  const creatorAta = await getOrCreateAssociatedTokenAccount(connection, authority, mintPk, creator.publicKey);
  const joinerAta = await getOrCreateAssociatedTokenAccount(connection, authority, mintPk, joiner.publicKey);

  for (const [label, ata] of [
    ['creator', creatorAta.address],
    ['joiner', joinerAta.address],
  ] as const) {
    const tx = new Transaction().add(
      createTransferInstruction(authAta.address, ata, authority.publicKey, BigInt(stake * 5))
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: 'confirmed' });
    console.log(`fund:${label}`, sig);
  }

  // Create match
  const created = await http<any>(baseUrl, '/api/matches', {
    method: 'POST',
    body: JSON.stringify({ mint, stake, creatorPubkey: creator.publicKey.toBase58() }),
  });
  const matchId = created.match.id as string;
  console.log('match:', matchId);

  async function deposit(from: Keypair, fromAtaAddr: PublicKey, role: 'creator' | 'joiner') {
    const tx = new Transaction();
    // authority is fee payer, but the token owner must sign
    tx.add(createTransferInstruction(fromAtaAddr, escrowAta, from.publicKey, BigInt(stake)));
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
    tx.partialSign(authority);
    tx.partialSign(from);

    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig, 'confirmed');
    console.log(`${role}:deposit`, sig);

    await http<any>(baseUrl, `/api/matches/${matchId}/deposit`, {
      method: 'POST',
      body: JSON.stringify({ role, tx: sig }),
    });
  }

  // Creator deposit
  await deposit(creator, creatorAta.address, 'creator');

  // Join
  await http<any>(baseUrl, `/api/matches/${matchId}/join`, {
    method: 'POST',
    body: JSON.stringify({ joinerPubkey: joiner.publicKey.toBase58() }),
  });

  // Joiner deposit
  await deposit(joiner, joinerAta.address, 'joiner');

  // Settle
  const settled = await http<any>(baseUrl, `/api/matches/${matchId}/settle`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  console.log('winner:', settled.match.winnerPubkey, 'flip:', settled.match.serverFlip);

  // Payout
  const paid = await http<any>(baseUrl, `/api/matches/${matchId}/payout`, {
    method: 'POST',
    body: JSON.stringify({ rpcUrl }),
  });
  console.log('payoutTx:', paid.tx);
  console.log('DONE status:', paid.match.status);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
