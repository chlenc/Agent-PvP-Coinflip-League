import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

type Row = {
  pubkey: string;
  wins: number;
  games: number;
  balance: number;
};

const balanceCache = new Map<string, { at: number; balance: number }>();
const BALANCE_TTL_MS = 30_000;

async function getBalance(mint: string, owner: string) {
  const now = Date.now();
  const cached = balanceCache.get(owner);
  if (cached && now - cached.at < BALANCE_TTL_MS) return cached.balance;

  const cluster = process.env.SOLANA_CLUSTER ?? process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet';
  const rpcUrl = process.env.SOLANA_RPC_URL ?? clusterApiUrl(cluster as any);
  const connection = new Connection(rpcUrl, 'confirmed');

  const mintPk = new PublicKey(mint);
  const ownerPk = new PublicKey(owner);

  try {
    const ata = await getAssociatedTokenAddress(mintPk, ownerPk);
    const bal = await connection.getTokenAccountBalance(ata, 'confirmed');
    const amount = Number(bal.value.amount ?? '0');
    balanceCache.set(owner, { at: now, balance: amount });
    return amount;
  } catch {
    balanceCache.set(owner, { at: now, balance: 0 });
    return 0;
  }
}

export async function GET() {
  const mint = process.env.NEXT_PUBLIC_MALTCOIN_MINT;
  if (!mint) {
    return NextResponse.json({ success: false, error: 'NEXT_PUBLIC_MALTCOIN_MINT missing' }, { status: 500 });
  }

  const winRows = db()
    .prepare(
      `SELECT winnerPubkey as pubkey, COUNT(*) as wins
       FROM matches
       WHERE status='SETTLED' AND winnerPubkey IS NOT NULL
       GROUP BY winnerPubkey
       ORDER BY wins DESC
       LIMIT 50`
    )
    .all() as Array<{ pubkey: string; wins: number }>;

  // games per pubkey (creator or joiner)
  const gameRows = db()
    .prepare(
      `SELECT pubkey, COUNT(*) as games FROM (
        SELECT creatorPubkey as pubkey FROM matches
        UNION ALL
        SELECT joinerPubkey as pubkey FROM matches WHERE joinerPubkey IS NOT NULL
      ) t
      GROUP BY pubkey`
    )
    .all() as Array<{ pubkey: string; games: number }>;

  const gamesMap = new Map(gameRows.map((r) => [r.pubkey, Number(r.games)]));

  const out: Row[] = [];
  for (const r of winRows) {
    const pubkey = r.pubkey;
    const wins = Number(r.wins);
    const games = gamesMap.get(pubkey) ?? wins;
    const balance = await getBalance(mint, pubkey);
    out.push({ pubkey, wins, games, balance });
  }

  return NextResponse.json({
    success: true,
    mint,
    rows: out,
    // client can build link using template
    maltbookTemplate:
      process.env.NEXT_PUBLIC_MALTBOOK_AGENT_URL_TEMPLATE ?? 'https://maltbook.com/agent/{pubkey}',
  });
}
