import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { db } from '@/lib/db';

const Settle = z.object({
  serverSeed: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = Settle.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const match = db().prepare('SELECT * FROM matches WHERE id=?').get(id);
  if (!match) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  if (match.status !== 'LOCKED') {
    return NextResponse.json({ success: false, error: 'match_not_locked' }, { status: 400 });
  }
  if (!match.joinerPubkey) {
    return NextResponse.json({ success: false, error: 'missing_joiner' }, { status: 400 });
  }

  const seed = parsed.data.serverSeed ?? crypto.randomBytes(16).toString('hex');
  const h = crypto.createHash('sha256').update(seed + ':' + match.id).digest();
  const flip = h[0] % 2; // 0 => creator, 1 => joiner
  const winnerPubkey = flip === 0 ? match.creatorPubkey : match.joinerPubkey;

  const now = new Date().toISOString();
  db()
    .prepare('UPDATE matches SET serverSeed=?, serverFlip=?, winnerPubkey=?, updatedAt=? WHERE id=?')
    .run(seed, flip, winnerPubkey, now, id);

  const updated = db().prepare('SELECT * FROM matches WHERE id=?').get(id);
  return NextResponse.json({ success: true, match: updated });
}
