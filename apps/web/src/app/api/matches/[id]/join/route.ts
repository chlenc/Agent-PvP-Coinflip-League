import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

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

  const match = await prisma.match.findUnique({ where: { id } });
  if (!match) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });
  if (match.status !== 'OPEN') {
    return NextResponse.json({ success: false, error: 'match_not_open' }, { status: 400 });
  }

  const updated = await prisma.match.update({
    where: { id },
    data: {
      joinerPubkey: parsed.data.joinerPubkey,
      joinerDepositTx: parsed.data.joinerDepositTx ?? null,
      status: 'LOCKED',
    },
  });

  return NextResponse.json({ success: true, match: updated });
}
