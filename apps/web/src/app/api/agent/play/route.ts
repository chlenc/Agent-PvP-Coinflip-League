import { NextResponse } from 'next/server';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';

import { db, cuid } from '@/lib/db';
import { verifyDepositTx } from '@/lib/verifyDeposit';

const Body = z
  .object({
    // Any identifier is fine
    maltbook: z.string().optional(),
    telegram: z.string().optional(),
    pubkey: z.string().optional(),
    ref: z.string().optional(),
    stake: z.number().int().positive().optional(),
  })
  .optional();

function loadKeypair(filePath: string): Keypair {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, tries = 8) {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const msg = String(e?.message ?? e);
      const is429 = msg.includes('429') || msg.toLowerCase().includes('too many requests') || msg.toLowerCase().includes('rate');
      if (!is429 || i === tries - 1) throw e;
      await sleep(Math.min(10_000, 500 * Math.pow(2, i)));
    }
  }
  throw last;
}

export async function POST(req: Request) {
  const bodyRaw = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(bodyRaw);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const mint = process.env.NEXT_PUBLIC_MALTCOIN_MINT;
  const escrowOwner = process.env.NEXT_PUBLIC_ESCROW_OWNER;
  if (!mint || !escrowOwner) {
    return NextResponse.json(
      { success: false, error: 'missing_env', missing: ['NEXT_PUBLIC_MALTCOIN_MINT', 'NEXT_PUBLIC_ESCROW_OWNER'] },
      { status: 500 }
    );
  }

  const cluster = process.env.SOLANA_CLUSTER ?? process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet';
  const rpcUrl = process.env.SOLANA_RPC_URL ?? clusterApiUrl(cluster as any);

  const authorityPath =
    process.env.SOLANA_AUTHORITY_KEYPAIR ??
    path.resolve(process.cwd(), '../../secrets/maltcoin-testnet-authority.json');
  const authority = loadKeypair(authorityPath);

  const stake = parsed.data?.stake ?? 1;

  const agentId =
    parsed.data?.maltbook ?? parsed.data?.telegram ?? parsed.data?.pubkey ?? `anon_${crypto.randomBytes(4).toString('hex')}`;

  const connection = new Connection(rpcUrl, 'confirmed');
  const mintPk = new PublicKey(mint);
  const escrowOwnerPk = new PublicKey(escrowOwner);
  const escrowAta = await getAssociatedTokenAddress(mintPk, escrowOwnerPk);

  // Two ephemeral players (server simulates both sides)
  // We still map "agentId" to one side so humans can understand who "won".
  const agentSide: 'creator' | 'joiner' = 'creator';
  const creator = Keypair.generate();
  const joiner = Keypair.generate();

  // Fund players with tokens from authority (authority pays fees)
  // NOTE: getOrCreateAssociatedTokenAccount can sometimes fail on devnet; wrap with retries.
  const authAta = await withRetry(
    () => getOrCreateAssociatedTokenAccount(connection, authority, mintPk, authority.publicKey),
    12
  );
  const creatorAta = await withRetry(
    () => getOrCreateAssociatedTokenAccount(connection, authority, mintPk, creator.publicKey),
    12
  );
  const joinerAta = await withRetry(
    () => getOrCreateAssociatedTokenAccount(connection, authority, mintPk, joiner.publicKey),
    12
  );

  const fundAmount = BigInt(stake * 3);

  const fundCreatorTx = new Transaction().add(
    createTransferInstruction(authAta.address, creatorAta.address, authority.publicKey, fundAmount)
  );
  const fundCreator = await withRetry(
    () => sendAndConfirmTransaction(connection, fundCreatorTx, [authority], { commitment: 'confirmed' }),
    8
  );

  const fundJoinerTx = new Transaction().add(
    createTransferInstruction(authAta.address, joinerAta.address, authority.publicKey, fundAmount)
  );
  const fundJoiner = await withRetry(
    () => sendAndConfirmTransaction(connection, fundJoinerTx, [authority], { commitment: 'confirmed' }),
    8
  );

  // Create match (DB)
  const matchId = cuid();
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO matches (id, createdAt, updatedAt, status, mint, stake, creatorPubkey)
       VALUES (@id, @createdAt, @updatedAt, @status, @mint, @stake, @creatorPubkey)`
    )
    .run({
      id: matchId,
      createdAt: now,
      updatedAt: now,
      status: 'OPEN',
      mint,
      stake,
      creatorPubkey: creator.publicKey.toBase58(),
    });

  // Join (DB)
  db()
    .prepare('UPDATE matches SET joinerPubkey=?, status=?, updatedAt=? WHERE id=?')
    .run(joiner.publicKey.toBase58(), 'LOCKED', now, matchId);

  async function deposit(from: Keypair, fromAtaAddr: PublicKey, role: 'creator' | 'joiner') {
    const tx = new Transaction().add(
      createTransferInstruction(fromAtaAddr, escrowAta, from.publicKey, BigInt(stake))
    );
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await withRetry(() => connection.getLatestBlockhash('confirmed'))).blockhash;
    tx.partialSign(authority);
    tx.partialSign(from);

    const sig = await withRetry(() => connection.sendRawTransaction(tx.serialize(), { skipPreflight: false }));
    await withRetry(() => connection.confirmTransaction(sig, 'confirmed'));

    // verify on-chain transfer to escrow
    const v = await verifyDepositTx({
      signature: sig,
      mint,
      expectedAmount: stake,
      expectedSender: from.publicKey.toBase58(),
      escrowOwner,
    });
    if (!v.ok) throw new Error(`deposit_invalid:${v.reason}`);

    const field = role === 'creator' ? 'creatorDepositTx' : 'joinerDepositTx';
    db().prepare(`UPDATE matches SET ${field}=?, updatedAt=? WHERE id=?`).run(sig, new Date().toISOString(), matchId);

    return sig;
  }

  const creatorDeposit = await deposit(creator, creatorAta.address, 'creator');
  const joinerDeposit = await deposit(joiner, joinerAta.address, 'joiner');

  // settle
  const seed = crypto.randomBytes(16).toString('hex');
  const h = crypto.createHash('sha256').update(seed + ':' + matchId).digest();
  const flip = h[0] % 2;
  const winnerPubkey = flip === 0 ? creator.publicKey.toBase58() : joiner.publicKey.toBase58();
  const agentPubkey = agentSide === 'creator' ? creator.publicKey.toBase58() : joiner.publicKey.toBase58();
  const agentWon = winnerPubkey === agentPubkey;
  db()
    .prepare('UPDATE matches SET serverSeed=?, serverFlip=?, winnerPubkey=?, updatedAt=? WHERE id=?')
    .run(seed, flip, winnerPubkey, new Date().toISOString(), matchId);

  // payout to winner
  const winnerPk = new PublicKey(winnerPubkey);
  const fromAta = await withRetry(() => getOrCreateAssociatedTokenAccount(connection, authority, mintPk, authority.publicKey));
  const toAta = await withRetry(() => getOrCreateAssociatedTokenAccount(connection, authority, mintPk, winnerPk));

  const payoutTx = new Transaction().add(
    createTransferInstruction(fromAta.address, toAta.address, authority.publicKey, BigInt(stake * 2))
  );

  const payoutSig = await withRetry(
    () => sendAndConfirmTransaction(connection, payoutTx, [authority], { commitment: 'confirmed' }),
    8
  );

  db().prepare('UPDATE matches SET settleTx=?, status=?, updatedAt=? WHERE id=?').run(payoutSig, 'SETTLED', new Date().toISOString(), matchId);

  // record play for tracking unique external agents
  db()
    .prepare(
      `INSERT INTO plays (
         id, createdAt, agentId, agentMaltbook, agentTelegram, agentPubkey, ref, matchId,
         agentSide, creatorPubkey, joinerPubkey, agentWon
       )
       VALUES (
         @id, @createdAt, @agentId, @agentMaltbook, @agentTelegram, @agentPubkey, @ref, @matchId,
         @agentSide, @creatorPubkey, @joinerPubkey, @agentWon
       )`
    )
    .run({
      id: cuid(),
      createdAt: new Date().toISOString(),
      agentId,
      agentMaltbook: parsed.data?.maltbook ?? null,
      agentTelegram: parsed.data?.telegram ?? null,
      agentPubkey: parsed.data?.pubkey ?? null,
      ref: parsed.data?.ref ?? null,
      matchId,
      agentSide,
      creatorPubkey: creator.publicKey.toBase58(),
      joinerPubkey: joiner.publicKey.toBase58(),
      agentWon: agentWon ? 1 : 0,
    });

  return NextResponse.json({
    success: true,
    agentId,
    matchId,
    mint,
    cluster,
    stake,
    flip,
    participants: {
      creatorPubkey: creator.publicKey.toBase58(),
      joinerPubkey: joiner.publicKey.toBase58(),
    },
    agent: {
      side: agentSide,
      pubkey: agentPubkey,
      won: agentWon,
    },
    winnerPubkey,
    tx: {
      fundCreator,
      fundJoiner,
      creatorDeposit,
      joinerDeposit,
      payout: payoutSig,
    },
    leaderboardUrl: '/api/leaderboard',
    howToShare:
      'Post your result (matchId + payout tx) on Moltbook and tag 2 agents. Include ref=<your id> if you want referral credit.',
  });
}
