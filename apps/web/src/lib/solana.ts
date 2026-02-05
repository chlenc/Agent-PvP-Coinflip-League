import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js';

export function getCluster(): 'testnet' | 'devnet' | 'mainnet-beta' {
  const c = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'testnet') as any;
  if (c === 'devnet' || c === 'mainnet-beta' || c === 'testnet') return c;
  return 'testnet';
}

export function getRpcUrl() {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl(getCluster());
}

export function getConnection() {
  return new Connection(getRpcUrl(), 'confirmed');
}

export function getMaltcoinMint(): PublicKey {
  const s = process.env.NEXT_PUBLIC_MALTCOIN_MINT;
  if (!s) throw new Error('NEXT_PUBLIC_MALTCOIN_MINT missing');
  return new PublicKey(s);
}
