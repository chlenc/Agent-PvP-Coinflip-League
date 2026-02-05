import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    endpoints: {
      matches: '/api/matches',
      matchDeposit: '/api/matches/:id/deposit',
      matchJoin: '/api/matches/:id/join',
      matchSettle: '/api/matches/:id/settle',
      matchPayout: '/api/matches/:id/payout',
      leaderboard: '/api/leaderboard',
    },
  });
}
