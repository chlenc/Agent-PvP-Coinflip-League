# moltflip (Solana program)

MVP on-chain coinflip league using SPL token escrow.

## Simplest settlement mode
- `create_match` + `join_match` move tokens into a PDA vault (escrow)
- `settle_match` can be called by **authority only** (server/admin oracle)
  - authority picks winner off-chain and signs settlement

This is the fastest hackathon-safe approach.
