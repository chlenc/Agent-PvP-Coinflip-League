import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { Connection, Keypair, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';

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
  const sol = Number(process.env.AIRDROP_SOL ?? 2);

  const authority = loadKeypair(authorityPath);
  const connection = new Connection(rpcUrl, 'confirmed');

  console.log('cluster:', network);
  console.log('rpc:', rpcUrl);
  console.log('pubkey:', authority.publicKey.toBase58());

  const before = await connection.getBalance(authority.publicKey, 'confirmed');
  console.log('balance before:', before / LAMPORTS_PER_SOL, 'SOL');

  const sig = await connection.requestAirdrop(authority.publicKey, Math.round(sol * LAMPORTS_PER_SOL));
  console.log('airdrop tx:', sig);

  const latest = await connection.getLatestBlockhash('confirmed');
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');

  const after = await connection.getBalance(authority.publicKey, 'confirmed');
  console.log('balance after:', after / LAMPORTS_PER_SOL, 'SOL');
}

main().catch((e) => {
  console.error('Airdrop failed:', e?.message ?? e);
  process.exit(1);
});
