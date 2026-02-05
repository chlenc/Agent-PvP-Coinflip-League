'use client';

import { useEffect, useMemo, useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';

const MINT = process.env.NEXT_PUBLIC_MALTCOIN_MINT!;
const ESCROW_OWNER = process.env.NEXT_PUBLIC_ESCROW_OWNER!; // authority pubkey

type Match = {
  id: string;
  status: 'OPEN' | 'LOCKED' | 'SETTLED' | 'CANCELED';
  mint: string;
  stake: number;
  creatorPubkey: string;
  joinerPubkey?: string | null;
  creatorDepositTx?: string | null;
  joinerDepositTx?: string | null;
  settleTx?: string | null;
  createdAt: string;
};

export default function Home() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [matches, setMatches] = useState<Match[]>([]);
  const [stake, setStake] = useState<number>(1);

  const mintPk = useMemo(() => new PublicKey(MINT), []);
  const escrowOwnerPk = useMemo(() => new PublicKey(ESCROW_OWNER), []);

  async function refresh() {
    const r = await fetch('/api/matches');
    const j = await r.json();
    if (j?.success) setMatches(j.matches);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  async function createMatch() {
    if (!publicKey) return;

    // create match in DB
    const res = await fetch('/api/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mint: mintPk.toBase58(), stake, creatorPubkey: publicKey.toBase58() }),
    });
    const j = await res.json();
    if (!j?.success) throw new Error('Failed to create match');

    // deposit stake to escrow (authority ATA)
    const fromAta = await getAssociatedTokenAddress(mintPk, publicKey);
    const escrowAta = await getAssociatedTokenAddress(mintPk, escrowOwnerPk);

    const ix = createTransferInstruction(fromAta, escrowAta, publicKey, BigInt(stake));
    const tx = new Transaction().add(ix);
    const sig = await sendTransaction(tx, connection);
    await connection.confirmTransaction(sig, 'confirmed');

    // TODO: store creatorDepositTx via separate endpoint
    await refresh();
  }

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">MoltFlip (testnet)</h1>
        <WalletMultiButton />
      </div>

      <div className="rounded border p-4 space-y-3">
        <div className="text-sm text-neutral-500">MALTCOIN mint: {MINT}</div>
        <div className="text-sm text-neutral-500">Escrow owner: {ESCROW_OWNER}</div>

        <div className="flex gap-3 items-center">
          <input
            className="border rounded px-3 py-2 w-32"
            type="number"
            min={1}
            value={stake}
            onChange={(e) => setStake(parseInt(e.target.value || '1', 10))}
          />
          <button
            className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
            disabled={!publicKey}
            onClick={() => createMatch().catch((e) => alert(e.message))}
          >
            Create match (deposit {stake})
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Recent matches</h2>
        <div className="space-y-2">
          {matches.map((m) => (
            <div key={m.id} className="border rounded p-3 text-sm">
              <div className="flex justify-between">
                <div className="font-mono">{m.id}</div>
                <div>{m.status}</div>
              </div>
              <div>stake: {m.stake}</div>
              <div className="truncate">creator: {m.creatorPubkey}</div>
              {m.joinerPubkey ? <div className="truncate">joiner: {m.joinerPubkey}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
