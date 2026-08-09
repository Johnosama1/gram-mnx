/**
 * TON chain helpers: deposit verification (toncenter) + automatic withdrawal payouts.
 * All env reads happen inside functions (Worker injects env per request).
 */

const TONCENTER = 'https://toncenter.com';

export function getDepositWallet(): string | undefined {
  return process.env['TON_DEPOSIT_WALLET'] || undefined;
}

function getTonApiKey(): string | undefined {
  return process.env['TON_API_KEY'] || process.env['TONCENTER_API_KEY'] || undefined;
}

/**
 * toncenter rejects invalid/expired keys with HTTP 401, which breaks payouts.
 * We probe the key once per worker instance and fall back to keyless access
 * (lower rate limit, but working) when it is not accepted.
 */
let apiKeyState: { key: string; valid: boolean } | null = null;

async function resolveTonApiKey(): Promise<string | undefined> {
  const key = getTonApiKey();
  if (!key) return undefined;
  if (apiKeyState && apiKeyState.key === key) return apiKeyState.valid ? key : undefined;
  let valid = true;
  try {
    const res = await fetch(`${TONCENTER}/api/v2/jsonRPC`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'getMasterchainInfo', params: {} }),
    });
    if (res.status === 401 || res.status === 403) valid = false;
  } catch {
    valid = true; // network hiccup: keep using the key
  }
  apiKeyState = { key, valid };
  if (!valid) console.error('[ton] TON_API_KEY rejected by toncenter (401) — falling back to keyless requests');
  return valid ? key : undefined;
}

export async function apiKeyHeaders(): Promise<Record<string, string>> {
  const key = await resolveTonApiKey();
  return key ? { 'X-API-Key': key } : {};
}


/** Normalizes any TON address form to a raw comparable string. */
export async function normalizeAddress(addr: string): Promise<string | null> {
  try {
    const { Address } = await import('@ton/core');
    return Address.parse(addr).toRawString();
  } catch {
    return null;
  }
}

export type ChainDeposit = { txHash: string; amountTon: number; from: string };

/**
 * Looks for a recent incoming transfer to the deposit wallet from `fromAddress`
 * with at least `minTon` value. Returns the matching transaction or null.
 */
export async function findIncomingDeposit(
  fromAddress: string,
  minTon: number,
): Promise<ChainDeposit | null> {
  const to = getDepositWallet();
  if (!to) return null;
  const wanted = await normalizeAddress(fromAddress);
  if (!wanted) return null;

  const url = `${TONCENTER}/api/v3/transactions?account=${encodeURIComponent(to)}&limit=50&sort=desc`;
  const res = await fetch(url, { headers: { Accept: 'application/json', ...(await apiKeyHeaders()) } });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    transactions?: { hash: string; in_msg?: { source?: string | null; value?: string | number | null } }[];
  } | null;

  for (const tx of body?.transactions ?? []) {
    const src = tx.in_msg?.source;
    if (!src) continue;
    const norm = await normalizeAddress(src);
    if (norm !== wanted) continue;
    const nano = Number(tx.in_msg?.value ?? 0);
    const amountTon = nano / 1e9;
    if (amountTon + 1e-9 < minTon * 0.98) continue;
    return { txHash: tx.hash, amountTon, from: src };
  }
  return null;
}

/** Reads the on-chain TON balance of any address. Returns null when unavailable. */
export async function getWalletBalanceTon(address: string): Promise<number | null> {
  try {
    const url = `${TONCENTER}/api/v2/getAddressBalance?address=${encodeURIComponent(address)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json', ...(await apiKeyHeaders()) } });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: string } | null;
    if (!body?.ok) return null;
    const nano = Number(body.result);
    return Number.isFinite(nano) ? nano / 1e9 : null;
  } catch {
    return null;
  }
}



export type PayoutResult =
  | { ok: true; txHash: string | null; pending?: boolean }
  | { ok: false; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|rate limit|too many requests/i.test(msg);
}

/** Retries a network call when it gets rate limited (HTTP 429). */
async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRateLimit(e)) throw e;
      await sleep(Math.min(1200 * (i + 1), 4000));
    }
  }
  throw lastError;
}

/** Payout wallet secret: mnemonic words OR a raw secret key (hex/base64). */
async function getPayoutSecret(): Promise<string | undefined> {
  // An admin-rotated key (set from the Security section) always wins over env.
  try {
    const { getPayoutSecretOverride } = await import('@/lib/security.server');
    const override = await getPayoutSecretOverride();
    if (override) return override;
  } catch {
    // fall back to environment keys
  }
  return process.env['OWNER_SECRET_KEY'] || process.env['TON_WITHDRAW_MNEMONIC'] || undefined;
}

/** True when automatic payouts can be performed. */
export async function hasPayoutWallet(): Promise<boolean> {
  return Boolean(await getPayoutSecret());
}

/** Derives the signing key pair from mnemonic words / seed / secret key bytes. */
async function deriveKeyPair(secret: string) {
  const { mnemonicToPrivateKey, keyPairFromSecretKey, keyPairFromSeed } = await import('@ton/crypto');
  const trimmed = secret.trim();
  const words = trimmed.split(/\s+/);
  if (words.length >= 12 && /^[a-zA-Z\s]+$/.test(trimmed)) {
    return { keyPair: await mnemonicToPrivateKey(words), error: null as string | null };
  }
  const decoded = decodeSecretBytes(trimmed);
  if (decoded?.length === 32) return { keyPair: keyPairFromSeed(decoded), error: null as string | null };
  if (decoded?.length === 64) return { keyPair: keyPairFromSecretKey(decoded), error: null as string | null };
  return {
    keyPair: null,
    error: `Unsupported payout wallet key format (decoded ${decoded?.length ?? 0} bytes); use a 24-word mnemonic, a 32-byte seed, or a 64-byte secret key`,
  };
}

type WalletCandidate = {
  version: 'V5R1' | 'V4' | 'V3R2' | 'V3R1';
  contract: { address: import('@ton/core').Address };
};

/**
 * Builds the wallet candidates for one key, newest version first.
 * Modern Telegram/Tonkeeper wallets are V5R1; the uploaded legacy tonweb
 * payout code used the older V3 family, including V3R1.
 */
async function deriveWalletCandidates(publicKey: Buffer) {
  const ton = await import('@ton/ton');
  return [
    { version: 'V5R1' as const, contract: ton.WalletContractV5R1.create({ workchain: 0, publicKey }) },
    { version: 'V4' as const, contract: ton.WalletContractV4.create({ workchain: 0, publicKey }) },
    { version: 'V3R2' as const, contract: ton.WalletContractV3R2.create({ workchain: 0, publicKey }) },
    { version: 'V3R1' as const, contract: ton.WalletContractV3R1.create({ workchain: 0, publicKey }) },
  ];
}

/** Picks the candidate matching the configured deposit wallet, else the newest (V5R1). */
async function pickWallet<T extends { version: string; contract: { address: { toRawString(): string } } }>(
  candidates: T[],
): Promise<T> {
  const depositWallet = getDepositWallet();
  const depositRaw = depositWallet ? await normalizeAddress(depositWallet) : null;
  if (depositRaw) {
    const match = candidates.find((c) => c.contract.address.toRawString() === depositRaw);
    if (match) return match;
  }
  return candidates[0]!;
}

/** Derives the public payout-wallet address without exposing its secret. */
export async function getPayoutWalletAddress(): Promise<string | null> {
  const secret = await getPayoutSecret();
  if (!secret) return null;
  try {
    const { keyPair } = await deriveKeyPair(secret);
    if (!keyPair) return null;
    const chosen = await pickWallet(await deriveWalletCandidates(keyPair.publicKey));
    return chosen.contract.address.toString({ bounceable: false });
  } catch {
    return null;
  }
}

/** All addresses this key controls (V5R1 / V4 / V3R2 / V3R1), for diagnostics. */
export async function getPayoutWalletAddresses(): Promise<{ version: string; address: string }[]> {
  const secret = await getPayoutSecret();
  if (!secret) return [];
  try {
    const { keyPair } = await deriveKeyPair(secret);
    if (!keyPair) return [];
    const candidates = await deriveWalletCandidates(keyPair.publicKey);
    return candidates.map((c) => ({
      version: c.version,
      address: c.contract.address.toString({ bounceable: false }),
    }));
  } catch {
    return [];
  }
}

/** True when any wallet version of the payout key matches the deposit wallet. */
export async function payoutWalletMatchesDepositWallet(): Promise<boolean> {
  const depositWallet = getDepositWallet();
  if (!depositWallet) return false;
  const depositRaw = await normalizeAddress(depositWallet);
  if (!depositRaw) return false;
  const addresses = await getPayoutWalletAddresses();
  for (const item of addresses) {
    if ((await normalizeAddress(item.address)) === depositRaw) return true;
  }
  return false;
}

/** Parses the payout secret into raw bytes, supporting hex, base64 and JSON byte arrays. */
function decodeSecretBytes(raw: string): Buffer | null {
  const trimmed = raw.trim();
  // JSON byte array, e.g. [12,34,...] (32 or 64 entries)
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        return Buffer.from(arr as number[]);
      }
    } catch {
      return null;
    }
    return null;
  }
  // Comma/space separated numbers without brackets
  if (/^\d{1,3}([,\s]+\d{1,3})+$/.test(trimmed)) {
    const nums = trimmed.split(/[,\s]+/).map(Number);
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return Buffer.from(nums);
    return null;
  }
  try {
    const buf = Buffer.from(trimmed, /^[0-9a-fA-F]+$/.test(trimmed) ? 'hex' : 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

/** Sends `amountTon` from the configured payout wallet to `toAddress`. */
export async function sendTonPayout(toAddress: string, amountTon: number): Promise<PayoutResult> {
  const secret = await getPayoutSecret();
  if (!secret) return { ok: false, error: 'payout wallet not configured' };
  if (!Number.isFinite(amountTon) || amountTon <= 0) return { ok: false, error: 'invalid payout amount' };
  try {
    const [ton, core] = await Promise.all([import('@ton/ton'), import('@ton/core')]);
    const { keyPair, error: keyError } = await deriveKeyPair(secret);
    if (!keyPair) return { ok: false, error: keyError ?? 'Invalid payout wallet key' };

    const client = new ton.TonClient({
      endpoint: `${TONCENTER}/api/v2/jsonRPC`,
      apiKey: await resolveTonApiKey(),
    });
    type OpenedWallet = {
      getSeqno(): Promise<number>;
      getBalance(): Promise<bigint>;
      sendTransfer(args: Record<string, unknown>): Promise<void>;
    };
    const open = (c: unknown) => client.open(c as never) as unknown as OpenedWallet;
    const candidates = await deriveWalletCandidates(keyPair.publicKey);
    // Prefer the version matching the deposit wallet; otherwise use the funded one.
    let chosen = await pickWallet(candidates);
    const transferValueCheck = core.toNano(amountTon.toFixed(9));
    // Keep enough TON for the complete external-message and forwarding fees.
    // This is a wallet-side reserve; the user still receives the requested amount.
    const feeReserveCheck = core.toNano('0.01');
    let chosenBalance: bigint = await withRetry(() => open(chosen.contract).getBalance());
    if (chosenBalance < transferValueCheck + feeReserveCheck) {
      for (const candidate of candidates) {
        if (candidate.version === chosen.version) continue;
        try {
          const bal: bigint = await withRetry(() => open(candidate.contract).getBalance());
          if (bal >= transferValueCheck + feeReserveCheck) {
            chosen = candidate;
            chosenBalance = bal;
            break;
          }
        } catch {
          /* ignore uninitialized candidates */
        }
      }
    }
    const wallet = chosen.contract;

    const destination = core.Address.parse(toAddress);
    if (destination.equals(wallet.address)) {
      return { ok: false, error: 'The withdrawal address is the payout wallet itself; the transfer was stopped to prevent self-sending' };
    }

    const contract = open(wallet);
    const seqno = await withRetry(() => contract.getSeqno());
    const balance = chosenBalance;
    const transferValue = core.toNano(amountTon.toFixed(9));
    // This is only a safety check, not an amount deducted from the user.
    const feeReserve = core.toNano('0.01');
    if (balance < transferValue + feeReserve) {
      const have = (Number(balance) / 1e9).toFixed(4);
      return {
        ok: false,
        error: `Payout wallet balance (${chosen.version}) is too low (available ${have} GRAM, about ${(amountTon + 0.01).toFixed(4)} GRAM needed including the fee reserve). Payout wallet address: ${wallet.address.toString({ bounceable: false })}`,
      };
    }
    const submittedAt = Math.floor(Date.now() / 1000);
    await withRetry(() =>
      contract.sendTransfer({
        secretKey: keyPair.secretKey,
        seqno,
        // V5R1 requires an explicit send mode (3 = pay gas separately + ignore errors).
        sendMode: 3,
        messages: [
          ton.internal({
            to: destination,
            value: transferValue,
            bounce: false,
            body: 'GRAM MNX withdrawal',
          }),
        ],
      }),
    );

    // A successful sendTransfer response only means the request was submitted.
    // Do not mark the withdrawal paid until the wallet seqno advances on-chain.
    let confirmed = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(1500);
      try {
        const currentSeqno = await contract.getSeqno();
        if (currentSeqno > seqno) {
          confirmed = true;
          break;
        }
      } catch (error) {
        if (!isRateLimit(error)) throw error;
      }
    }
    // The transfer was already broadcast; never report failure here, otherwise a
    // retry could pay the same withdrawal twice.
    if (!confirmed) return { ok: true, txHash: null, pending: true };

    // Look up the outgoing transaction hash (retry: indexers lag a few seconds).
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const transactions = await withRetry(() => client.getTransactions(wallet.address, { limit: 5 }));
        const transaction = transactions.find(
          (item) => item.outMessagesCount > 0 && item.now >= submittedAt - 5,
        );
        // hex form: this is what tonviewer/tonscan accept in URLs (base64url 404s there)
        if (transaction) return { ok: true, txHash: transaction.hash().toString('hex') };
      } catch {
        /* keep retrying */
      }
      await sleep(2000);
    }
    return { ok: true, txHash: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: isRateLimit(e)
        ? 'The GRAM network is temporarily congested — please try again shortly'
        : msg,
    };
  }
}