import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

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

  const match = await prisma.match.findUnique({ where: { id } });
  if (!match) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });

  const data: any = {};
  if (parsed.data.role === 'creator') data.creatorDepositTx = parsed.data.tx;
  if (parsed.data.role === 'joiner') data.joinerDepositTx = parsed.data.tx;

  const updated = await prisma.match.update({ where: { id }, data });
  return NextResponse.json({ success: true, match: updated });
}
