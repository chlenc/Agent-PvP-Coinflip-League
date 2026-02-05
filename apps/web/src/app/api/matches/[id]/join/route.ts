import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';

const Join = z.object({
  joinerPubkey: z.string(),
  joinerDepositTx: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = Join.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const match = db().prepare('SELECT * FROM matches WHERE id=?').get(id);
  if (!match) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  if (match.status !== 'OPEN') {
    return NextResponse.json({ success: false, error: 'match_not_open' }, { status: 400 });
  }

  const now = new Date().toISOString();
  db()
    .prepare(
      'UPDATE matches SET joinerPubkey=?, joinerDepositTx=?, status=?, updatedAt=? WHERE id=?'
    )
    .run(parsed.data.joinerPubkey, parsed.data.joinerDepositTx ?? null, 'LOCKED', now, id);

  const updated = db().prepare('SELECT * FROM matches WHERE id=?').get(id);
  return NextResponse.json({ success: true, match: updated });
}
