import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { verifyDepositTx } from '@/lib/verifyDeposit';

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

  const match = db().prepare('SELECT * FROM matches WHERE id=?').get(id) as any;
  if (!match) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });

  const expectedSender = parsed.data.role === 'creator' ? match.creatorPubkey : match.joinerPubkey;
  if (!expectedSender) {
    return NextResponse.json({ success: false, error: 'missing_sender' }, { status: 400 });
  }

  const escrowOwner = process.env.NEXT_PUBLIC_ESCROW_OWNER;
  if (!escrowOwner) {
    return NextResponse.json({ success: false, error: 'missing_escrow_owner_env' }, { status: 500 });
  }

  const verify = await verifyDepositTx({
    signature: parsed.data.tx,
    mint: match.mint,
    expectedAmount: match.stake,
    expectedSender,
    escrowOwner,
  });

  if (!verify.ok) {
    return NextResponse.json(
      { success: false, error: 'deposit_tx_invalid', reason: verify.reason, escrowAta: (verify as any).escrowAta },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const field = parsed.data.role === 'creator' ? 'creatorDepositTx' : 'joinerDepositTx';

  db()
    .prepare(`UPDATE matches SET ${field}=?, updatedAt=? WHERE id=?`)
    .run(parsed.data.tx, now, id);

  const updated = db().prepare('SELECT * FROM matches WHERE id=?').get(id);
  return NextResponse.json({ success: true, match: updated });
}
