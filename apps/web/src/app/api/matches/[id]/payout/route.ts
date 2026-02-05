import { NextResponse } from 'next/server';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
} from '@solana/spl-token';
import { db } from '@/lib/db';

const Payout = z.object({
  // optional override
  rpcUrl: z.string().optional(),
});

function loadKeypair(filePath: string): Keypair {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = Payout.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const match = db().prepare('SELECT * FROM matches WHERE id=?').get(id) as any;
  if (!match) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  if (!match.winnerPubkey) {
    return NextResponse.json({ success: false, error: 'winner_not_set' }, { status: 400 });
  }
  if (match.status !== 'LOCKED') {
    return NextResponse.json({ success: false, error: 'match_not_locked' }, { status: 400 });
  }

  const cluster = process.env.SOLANA_CLUSTER ?? 'testnet';
  const rpcUrl = parsed.data.rpcUrl ?? process.env.SOLANA_RPC_URL ?? clusterApiUrl(cluster as any);
  const authorityPath =
    process.env.SOLANA_AUTHORITY_KEYPAIR ??
    path.resolve(process.cwd(), '../../secrets/maltcoin-testnet-authority.json');

  const authority = loadKeypair(authorityPath);
  const connection = new Connection(rpcUrl, 'confirmed');

  const mint = new PublicKey(match.mint);
  const winner = new PublicKey(match.winnerPubkey);

  const fromAta = await getOrCreateAssociatedTokenAccount(connection, authority, mint, authority.publicKey);
  const toAta = await getOrCreateAssociatedTokenAccount(connection, authority, mint, winner);

  const amount = BigInt(match.stake * 2);

  const tx = new Transaction().add(
    createTransferInstruction(fromAta.address, toAta.address, authority.publicKey, amount)
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: 'confirmed',
  });

  const now = new Date().toISOString();
  db()
    .prepare('UPDATE matches SET settleTx=?, status=?, updatedAt=? WHERE id=?')
    .run(sig, 'SETTLED', now, id);

  const updated = db().prepare('SELECT * FROM matches WHERE id=?').get(id);
  return NextResponse.json({ success: true, match: updated, tx: sig });
}
