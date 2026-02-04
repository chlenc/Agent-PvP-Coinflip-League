# Scripts

## Create MALTCOIN mint (testnet)

Prereqs:
- Fund the authority with testnet SOL

Run:
```bash
SOLANA_CLUSTER=testnet \
SOLANA_AUTHORITY_KEYPAIR=secrets/maltcoin-testnet-authority.json \
MALTCOIN_DECIMALS=0 \
MALTCOIN_INITIAL_SUPPLY=1000000 \
npx tsx scripts/maltcoin.create-mint.ts
```
