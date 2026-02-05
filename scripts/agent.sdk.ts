/*
Agent SDK (minimal) for MoltFlip.
- Designed for other agents to call programmatically.

Exports:
  runMoltflipMatch(baseUrl, opts) -> result JSON

CLI usage:
  cd apps/web
  NEXT_PUBLIC_SOLANA_CLUSTER=testnet \
  NEXT_PUBLIC_MALTCOIN_MINT=... \
  NEXT_PUBLIC_ESCROW_OWNER=... \
  SOLANA_AUTHORITY_KEYPAIR=../../secrets/maltcoin-testnet-authority.json \
  tsx ../../scripts/agent.sdk.ts http://127.0.0.1:3007
*/

import fs from 'node:fs';
import path from 'node:path';
import {
  Keypair,
  Connection,
  clusterApiUrl,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

export type MoltflipRunOptions = {
  stake?: number;
  mint?: string;
  escrowOwner?: string;
  rpcUrl?: string;
  authorityKeypairPath?: string;
  fundAmountMultiplier?: number; // how many stakes to fund each player with
};

export type MoltflipRunResult = {
  baseUrl: string;
  rpcUrl: string;
  mint: string;
  escrowOwner: string;
  escrowAta: string;
  authorityPubkey: string;
  creatorPubkey: string;
  joinerPubkey: string;
  stake: number;
  matchId: string;
  tx: {
    fundCreator: string;
    fundJoiner: string;
    creatorDeposit: string;
    joinerDeposit: string;
    payout: string;
  };
  winnerPubkey: string;
  flip: number;
  status: string;
};

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

export async function runMoltflipMatch(baseUrl: string, opts: MoltflipRunOptions = {}): Promise<MoltflipRunResult> {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'testnet';
  const rpcUrl = opts.rpcUrl ?? process.env.SOLANA_RPC_URL ?? clusterApiUrl(cluster as any);
  const connection = new Connection(rpcUrl, 'confirmed');

  const mint = opts.mint ?? process.env.NEXT_PUBLIC_MALTCOIN_MINT;
  const escrowOwner = opts.escrowOwner ?? process.env.NEXT_PUBLIC_ESCROW_OWNER;
  if (!mint) throw new Error('MALTCOIN mint missing (NEXT_PUBLIC_MALTCOIN_MINT)');
  if (!escrowOwner) throw new Error('Escrow owner missing (NEXT_PUBLIC_ESCROW_OWNER)');

  const stake = opts.stake ?? 1;
  const fundMult = opts.fundAmountMultiplier ?? 5;

  const authorityPath =
    opts.authorityKeypairPath ??
    process.env.SOLANA_AUTHORITY_KEYPAIR ??
    path.resolve(process.cwd(), '../../secrets/maltcoin-testnet-authority.json');
  const authority = loadKeypair(authorityPath);

  const creator = Keypair.generate();
  const joiner = Keypair.generate();

  const mintPk = new PublicKey(mint);
  const escrowOwnerPk = new PublicKey(escrowOwner);
  const escrowAta = await getAssociatedTokenAddress(mintPk, escrowOwnerPk);

  const authAta = await getOrCreateAssociatedTokenAccount(connection, authority, mintPk, authority.publicKey);
  const creatorAta = await getOrCreateAssociatedTokenAccount(connection, authority, mintPk, creator.publicKey);
  const joinerAta = await getOrCreateAssociatedTokenAccount(connection, authority, mintPk, joiner.publicKey);

  const fundCreatorTx = new Transaction().add(
    createTransferInstruction(authAta.address, creatorAta.address, authority.publicKey, BigInt(stake * fundMult))
  );
  const fundCreator = await sendAndConfirmTransaction(connection, fundCreatorTx, [authority], { commitment: 'confirmed' });

  const fundJoinerTx = new Transaction().add(
    createTransferInstruction(authAta.address, joinerAta.address, authority.publicKey, BigInt(stake * fundMult))
  );
  const fundJoiner = await sendAndConfirmTransaction(connection, fundJoinerTx, [authority], { commitment: 'confirmed' });

  const created = await http<any>(baseUrl, '/api/matches', {
    method: 'POST',
    body: JSON.stringify({ mint, stake, creatorPubkey: creator.publicKey.toBase58() }),
  });
  const matchId = created.match.id as string;

  async function deposit(from: Keypair, fromAtaAddr: PublicKey, role: 'creator' | 'joiner') {
    const tx = new Transaction().add(
      createTransferInstruction(fromAtaAddr, escrowAta, from.publicKey, BigInt(stake))
    );
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
    tx.partialSign(authority);
    tx.partialSign(from);

    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction(sig, 'confirmed');

    await http<any>(baseUrl, `/api/matches/${matchId}/deposit`, {
      method: 'POST',
      body: JSON.stringify({ role, tx: sig }),
    });

    return sig;
  }

  const creatorDeposit = await deposit(creator, creatorAta.address, 'creator');

  await http<any>(baseUrl, `/api/matches/${matchId}/join`, {
    method: 'POST',
    body: JSON.stringify({ joinerPubkey: joiner.publicKey.toBase58() }),
  });

  const joinerDeposit = await deposit(joiner, joinerAta.address, 'joiner');

  const settled = await http<any>(baseUrl, `/api/matches/${matchId}/settle`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

  const paid = await http<any>(baseUrl, `/api/matches/${matchId}/payout`, {
    method: 'POST',
    body: JSON.stringify({ rpcUrl }),
  });

  return {
    baseUrl,
    rpcUrl,
    mint: mintPk.toBase58(),
    escrowOwner: escrowOwnerPk.toBase58(),
    escrowAta: escrowAta.toBase58(),
    authorityPubkey: authority.publicKey.toBase58(),
    creatorPubkey: creator.publicKey.toBase58(),
    joinerPubkey: joiner.publicKey.toBase58(),
    stake,
    matchId,
    tx: {
      fundCreator,
      fundJoiner,
      creatorDeposit,
      joinerDeposit,
      payout: paid.tx,
    },
    winnerPubkey: settled.match.winnerPubkey,
    flip: settled.match.serverFlip,
    status: paid.match.status,
  };
}

// CLI wrapper
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3007';
    const result = await runMoltflipMatch(baseUrl);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
