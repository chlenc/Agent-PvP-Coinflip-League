# Architecture (MVP)

## Accounts
- `Config` (PDA): stores `authority` and `mint`
- `Match` (PDA): stores creator, joiner, stake, status
- `Vault` (ATA owned by Match PDA): holds 2*stake MALTCOIN

## Instructions
- `init_config(authority, mint)`
- `create_match(stake)`
  - creates Match PDA
  - transfers `stake` from creator ATA -> vault ATA
- `join_match()`
  - sets joiner
  - transfers `stake` from joiner ATA -> vault ATA
- `settle_match(winner)` (authority only)
  - transfers `2*stake` vault -> winner ATA
  - marks match as settled

## RNG
Authority oracle (server/admin) decides winner.
