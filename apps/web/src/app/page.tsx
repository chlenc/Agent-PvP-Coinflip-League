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
  winnerPubkey?: string | null;
  creatorDepositTx?: string | null;
  joinerDepositTx?: string | null;
  settleTx?: string | null;
  createdAt: string;
};

export default function Home() {
  const { publicKey, sendTransaction, wallet } = useWallet();
  const { connection } = useConnection();
  const [hasProvider, setHasProvider] = useState<boolean>(true);

  useEffect(() => {
    // In-app browsers (Telegram, etc.) usually don't expose wallet extensions.
    // For MVP we support desktop extensions only.
    // @ts-expect-error global
    const ok = typeof window !== 'undefined' && (window.solana || window.solflare);
    setHasProvider(Boolean(ok));
  }, []);

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
    const matchId: string = j.match.id;

    // deposit stake to escrow (authority ATA)
    const fromAta = await getAssociatedTokenAddress(mintPk, publicKey);
    const escrowAta = await getAssociatedTokenAddress(mintPk, escrowOwnerPk);

    const ix = createTransferInstruction(fromAta, escrowAta, publicKey, BigInt(stake));
    const tx = new Transaction().add(ix);
    const sig = await sendTransaction(tx, connection);
    await connection.confirmTransaction(sig, 'confirmed');

    await fetch(`/api/matches/${matchId}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'creator', tx: sig }),
    });

    await refresh();
  }

  async function joinMatch(matchId: string, stakeAmount: number) {
    if (!publicKey) return;

    const fromAta = await getAssociatedTokenAddress(mintPk, publicKey);
    const escrowAta = await getAssociatedTokenAddress(mintPk, escrowOwnerPk);

    const ix = createTransferInstruction(fromAta, escrowAta, publicKey, BigInt(stakeAmount));
    const tx = new Transaction().add(ix);
    const sig = await sendTransaction(tx, connection);
    await connection.confirmTransaction(sig, 'confirmed');

    await fetch(`/api/matches/${matchId}/deposit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'joiner', tx: sig }),
    });

    const res = await fetch(`/api/matches/${matchId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joinerPubkey: publicKey.toBase58(), joinerDepositTx: sig }),
    });

    const j = await res.json();
    if (!j?.success) throw new Error('Failed to join');
    await refresh();
  }

  async function settleMatch(matchId: string) {
    // server decides winner
    const res = await fetch(`/api/matches/${matchId}/settle`, { method: 'POST' });
    const j = await res.json();
    if (!j?.success) throw new Error('Failed to settle');

    // server pays out from authority
    const res2 = await fetch(`/api/matches/${matchId}/payout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j2 = await res2.json();
    if (!j2?.success) throw new Error('Payout failed');

    await refresh();
  }

  return (
    <main className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">MoltFlip (testnet)</h1>
        <WalletMultiButton />
      </div>

      {!hasProvider ? (
        <div className="rounded border p-4 text-sm">
          Wallet not detected. Open this page in a desktop browser with Phantom/Solflare extension (not Telegram in-app browser).
        </div>
      ) : null}

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
            <div key={m.id} className="border rounded p-3 text-sm space-y-1">
              <div className="flex justify-between gap-2">
                <div className="font-mono truncate">{m.id}</div>
                <div>{m.status}</div>
              </div>
              <div>stake: {m.stake}</div>
              <div className="truncate">creator: {m.creatorPubkey}</div>
              {m.joinerPubkey ? <div className="truncate">joiner: {m.joinerPubkey}</div> : null}
              {m.winnerPubkey ? <div className="truncate">winner: {m.winnerPubkey}</div> : null}
              {m.creatorDepositTx ? <div className="truncate">creator tx: {m.creatorDepositTx}</div> : null}
              {m.joinerDepositTx ? <div className="truncate">joiner tx: {m.joinerDepositTx}</div> : null}
              {m.settleTx ? <div className="truncate">payout tx: {m.settleTx}</div> : null}

              <div className="flex gap-2 pt-2">
                <button
                  className="border rounded px-3 py-1 disabled:opacity-50"
                  disabled={!publicKey || m.status !== 'OPEN'}
                  onClick={() => joinMatch(m.id, m.stake).catch((e) => alert(e.message))}
                >
                  Join (deposit {m.stake})
                </button>
                <button
                  className="border rounded px-3 py-1 disabled:opacity-50"
                  disabled={m.status !== 'LOCKED'}
                  onClick={() => settleMatch(m.id).catch((e) => alert(e.message))}
                >
                  Settle + Payout
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
