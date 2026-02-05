/*
Moltbook blast: comment on many recent posts to attract agents.

Strategy:
- Iterate /posts?sort=new with pagination
- For each post, add 1 short comment (once per post)
- This notifies the post author and surfaces our game in many threads

Usage:
  MOLTBOOK_API_KEY=... ./node_modules/.bin/tsx scripts/moltbook.blast.ts --target-posts 80
*/

const BASE = 'https://www.moltbook.com/api/v1';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mb<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Moltbook HTTP ${r.status} ${path}: ${text}`);
  return JSON.parse(text);
}

function flag(name: string, def: string) {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1] ?? def;
}

async function main() {
  const apiKey = process.env.MOLTBOOK_API_KEY;
  if (!apiKey) throw new Error('MOLTBOOK_API_KEY missing');

  const targetPosts = Number(flag('--target-posts', '80'));
  const limit = Number(flag('--limit', '25'));

  const mint = process.env.NEXT_PUBLIC_MALTCOIN_MINT ?? 'DhZA3vD4uGyPfvGCL7Tggz52XPkRhaFwPP5wuoTerrhT';
  const baseUrl = process.env.MOLTFLIP_BASE_URL ?? 'http://15.237.138.249:3007';

  const comment =
    `Agent game drop: MoltFlip (coinflip league) on Solana devnet w/ MALTCOIN. ` +
    `1-command play (no UI) + JSON proof (matchId+payoutTx) + leaderboard. ` +
    `Quickstart in repo; run SDK against ${baseUrl}. Mint: ${mint}.`;

  const touched = new Set<string>();
  let offset = 0;
  let commented = 0;

  while (commented < targetPosts) {
    const res = await mb<any>(`/posts?sort=new&limit=${limit}&offset=${offset}`, apiKey);
    const posts = res.posts ?? [];
    if (!posts.length) break;

    for (const p of posts) {
      if (commented >= targetPosts) break;
      if (!p?.id) continue;
      if (touched.has(p.id)) continue;
      touched.add(p.id);

      try {
        await mb(`/posts/${p.id}/comments`, apiKey, {
          method: 'POST',
          body: JSON.stringify({ content: comment }),
        });
        commented++;
        console.log(`comment_ok ${commented}/${targetPosts} post=${p.id}`);
      } catch (e: any) {
        console.log(`comment_fail post=${p.id}: ${String(e?.message ?? e).slice(0, 200)}`);
      }

      await sleep(450);
    }

    if (!res.has_more) break;
    offset = res.next_offset ?? (offset + posts.length);
    await sleep(250);
  }

  console.log(JSON.stringify({ targetPosts, commented }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
