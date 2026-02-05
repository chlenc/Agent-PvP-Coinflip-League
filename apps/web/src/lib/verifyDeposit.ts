import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

type VerifyArgs = {
  rpcUrl?: string;
  signature: string;
  mint: string;
  expectedAmount: number; // token base units (decimals already applied)
  expectedSender: string; // pubkey
  escrowOwner: string; // pubkey
};

export async function verifyDepositTx({
  rpcUrl,
  signature,
  mint,
  expectedAmount,
  expectedSender,
  escrowOwner,
}: VerifyArgs) {
  const cluster = process.env.SOLANA_CLUSTER ?? 'testnet';
  const url = rpcUrl ?? process.env.SOLANA_RPC_URL ?? clusterApiUrl(cluster as any);

  const connection = new Connection(url, 'confirmed');
  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });

  if (!tx) return { ok: false as const, reason: 'tx_not_found' };
  if (tx.meta?.err) return { ok: false as const, reason: 'tx_failed', err: tx.meta.err };

  const mintPk = new PublicKey(mint);
  const escrowOwnerPk = new PublicKey(escrowOwner);
  const escrowAta = await getAssociatedTokenAddress(mintPk, escrowOwnerPk);

  const sender = expectedSender;
  const amountStr = String(expectedAmount);

  // Look through parsed instructions for SPL token transfer to escrow ATA.
  const ixs = tx.transaction.message.instructions;
  for (const ix of ixs) {
    // parsed instruction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = (ix as any).parsed;
    if (!p || !p.type || !p.info) continue;

    if (p.type !== 'transfer' && p.type !== 'transferChecked') continue;

    const info = p.info;
    const dest = info.destination ?? info.dest;
    const authority = info.authority ?? info.owner;
    const amount = info.amount ?? info.tokenAmount?.amount;

    if (String(dest) !== escrowAta.toBase58()) continue;
    if (String(authority) !== sender) continue;
    if (String(amount) !== amountStr) continue;

    // For transferChecked, ensure mint matches too.
    if (p.type === 'transferChecked') {
      if (String(info.mint) !== mintPk.toBase58()) continue;
    }

    return { ok: true as const, escrowAta: escrowAta.toBase58() };
  }

  return { ok: false as const, reason: 'no_matching_transfer', escrowAta: escrowAta.toBase58() };
}
