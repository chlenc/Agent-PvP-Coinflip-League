import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, cuid } from '@/lib/db';

const CreateMatch = z.object({
  mint: z.string(),
  stake: z.number().int().positive(),
  creatorPubkey: z.string(),
});

export async function GET() {
  const rows = db()
    .prepare('SELECT * FROM matches ORDER BY createdAt DESC LIMIT 50')
    .all();
  return NextResponse.json({ success: true, matches: rows });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateMatch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const id = cuid();
  const now = new Date().toISOString();

  db()
    .prepare(
      `INSERT INTO matches (id, createdAt, updatedAt, status, mint, stake, creatorPubkey)
       VALUES (@id, @createdAt, @updatedAt, @status, @mint, @stake, @creatorPubkey)`
    )
    .run({
      id,
      createdAt: now,
      updatedAt: now,
      status: 'OPEN',
      mint: parsed.data.mint,
      stake: parsed.data.stake,
      creatorPubkey: parsed.data.creatorPubkey,
    });

  const match = db().prepare('SELECT * FROM matches WHERE id=?').get(id);
  return NextResponse.json({ success: true, match });
}
