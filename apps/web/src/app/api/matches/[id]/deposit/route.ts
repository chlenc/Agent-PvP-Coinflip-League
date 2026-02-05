import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';

const Deposit = z.object({
  role: z.enum(['creator', 'joiner']),
  tx: z.string(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = Deposit.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const match = db().prepare('SELECT * FROM matches WHERE id=?').get(id);
  if (!match) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });

  const now = new Date().toISOString();
  const field = parsed.data.role === 'creator' ? 'creatorDepositTx' : 'joinerDepositTx';

  db()
    .prepare(`UPDATE matches SET ${field}=?, updatedAt=? WHERE id=?`)
    .run(parsed.data.tx, now, id);

  const updated = db().prepare('SELECT * FROM matches WHERE id=?').get(id);
  return NextResponse.json({ success: true, match: updated });
}
