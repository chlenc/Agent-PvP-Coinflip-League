import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} from '@solana/spl-token';

function loadKeypair(filePath: string): Keypair {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

async function main() {
  const network = process.env.SOLANA_CLUSTER ?? 'testnet';
  const rpcUrl = process.env.SOLANA_RPC_URL ?? clusterApiUrl(network as any);
  const authorityPath =
    process.env.SOLANA_AUTHORITY_KEYPAIR ??
    path.resolve('secrets/maltcoin-testnet-authority.json');

  const decimals = Number(process.env.MALTCOIN_DECIMALS ?? 0);
  const initialSupply = BigInt(process.env.MALTCOIN_INITIAL_SUPPLY ?? '1000000');

  const authority = loadKeypair(authorityPath);
  const connection = new Connection(rpcUrl, 'confirmed');

  console.log('cluster:', network);
  console.log('rpc:', rpcUrl);
  console.log('authority:', authority.publicKey.toBase58());

  // Create Mint
  const mint = await createMint(
    connection,
    authority,
    authority.publicKey,
    null,
    decimals
  );

  // Create ATA for authority and mint initial supply
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    authority.publicKey
  );

  const sig = await mintTo(
    connection,
    authority,
    mint,
    ata.address,
    authority,
    initialSupply
  );

  const mintInfo = await getMint(connection, mint);

  console.log('mint:', mint.toBase58());
  console.log('ata:', ata.address.toBase58());
  console.log('decimals:', mintInfo.decimals);
  console.log('supply:', mintInfo.supply.toString());
  console.log('mintTo tx:', sig);

  console.log('\nNext: save MALTCOIN_MINT=' + mint.toBase58() + ' in apps/web/.env.local');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
