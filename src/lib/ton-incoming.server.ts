/** Fetches recent incoming transfers to the deposit wallet from toncenter v3. */
import { getDepositWallet, apiKeyHeaders } from '@/lib/ton.server';

const TONCENTER = 'https://toncenter.com';

export type IncomingTx = {
  txHash: string;
  amountTon: number;
  from: string;
  utime: number;
  comment: string | null;
};

/** Returns confirmed incoming transfers (newest first). */
export async function fetchIncomingTransfers(limit = 50): Promise<IncomingTx[]> {
  const to = getDepositWallet();
  if (!to) return [];
  const url = `${TONCENTER}/api/v3/transactions?account=${encodeURIComponent(to)}&limit=${limit}&sort=desc`;
  const res = await fetch(url, { headers: { Accept: 'application/json', ...(await apiKeyHeaders()) } });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as {
    transactions?: {
      hash: string;
      now?: number;
      description?: { aborted?: boolean } | null;
      in_msg?: {
        source?: string | null;
        value?: string | number | null;
        message_content?: { decoded?: { comment?: string } | null } | null;
      } | null;
    }[];
  } | null;

  const out: IncomingTx[] = [];
  for (const tx of body?.transactions ?? []) {
    const src = tx.in_msg?.source;
    const nano = Number(tx.in_msg?.value ?? 0);
    if (!src || !Number.isFinite(nano) || nano <= 0) continue;
    if (tx.description?.aborted) continue;
    out.push({
      txHash: tx.hash,
      amountTon: nano / 1e9,
      from: src,
      utime: Number(tx.now ?? 0),
      comment: tx.in_msg?.message_content?.decoded?.comment ?? null,
    });
  }
  return out;
}
