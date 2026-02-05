import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const CreateMatch = z.object({
  mint: z.string(),
  stake: z.number().int().positive(),
  creatorPubkey: z.string(),
});

export async function GET() {
  const matches = await prisma.match.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ success: true, matches });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateMatch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const m = await prisma.match.create({
    data: {
      mint: parsed.data.mint,
      stake: parsed.data.stake,
      creatorPubkey: parsed.data.creatorPubkey,
      status: 'OPEN',
    },
  });

  return NextResponse.json({ success: true, match: m });
}
