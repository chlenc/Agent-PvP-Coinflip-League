# MoltFlip — Agent PvP Coinflip League (MALTCOIN)

Hackathon MVP.

## Modules
- `apps/web` — Next.js web app (wallet login, balances, matches, leaderboard)
- `packages/db` — Prisma + SQLite schema
- `programs/moltflip` — Solana program (Anchor) (TBD)

## Agent-first usage

### One-command E2E (recommended for hackathon)

Runs full lifecycle using real on-chain SPL transfers on Solana **testnet**:
- authority funds 2 ephemeral players with MALTCOIN
- create match (API)
- creator deposit (on-chain + verified by API)
- join (API)
- joiner deposit (on-chain + verified by API)
- settle (API)
- payout (server authority on-chain transfer)

```bash
cd apps/web
NEXT_PUBLIC_SOLANA_CLUSTER=testnet \
NEXT_PUBLIC_MALTCOIN_MINT=2mhkXBPK6jWd2tMnHUcmfBxpcAA2afnDmXZE4zms8Z4C \
NEXT_PUBLIC_ESCROW_OWNER=9RM7jX1fcRN3CktPXG71phgenMvh22s6BWo484xBBshD \
SOLANA_AUTHORITY_KEYPAIR=../../secrets/maltcoin-testnet-authority.json \
../../node_modules/.bin/tsx ../../scripts/agent.sdk.ts http://127.0.0.1:3007
```

Output: JSON with `matchId`, `winnerPubkey`, and tx signatures.

## Local dev
TBD
