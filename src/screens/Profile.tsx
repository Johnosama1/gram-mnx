import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { cachedFetch, invalidateApi, notifyDataChange } from '@/lib/apiCache';
import { ArrowLeftRight, ChevronRight, Check, ArrowUp, ArrowDown, Wallet, LifeBuoy, MessageSquare, Lightbulb, Headphones, HelpCircle } from 'lucide-react';
import { useWallet } from '@/context/WalletContext';
import { useCoins } from '@/context/CoinsContext';
import { shortFriendlyAddress, toFriendlyAddress } from '@/lib/tonAddress';

import { useTelegramUser } from '@/context/TelegramUserContext';
import { useLanguage, SUPPORTED_LANGUAGES, type Lang } from '@/context/LanguageContext';
import languageSticker from '@/assets/language-sticker.webm.asset.json';
import flagUsSticker from '@/assets/flag-us.json.asset.json';
import flagRuSticker from '@/assets/flag-ru.json.asset.json';
import { telegramApiPost, getInitData, API_BASE } from '@/lib/telegramApi';
import WalletModal from '@/components/WalletModal';
import StickerBadge from '@/components/StickerBadge';
import walletSticker from '@/assets/wallet-sticker.json.asset.json';
import purseSticker from '@/assets/purse-sticker.json.asset.json';
import swapSticker from '@/assets/swap-sticker.json.asset.json';
import gearSticker from '@/assets/gear-sticker.json.asset.json';
import downloadSticker from '@/assets/download-sticker.json.asset.json';
import supportBalloonSticker from '@/assets/support-balloon.json.asset.json';
import capWingsSticker from '@/assets/cap-wings.json.asset.json';
import { useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';


// ─── Swap Panel (Gram ⇄ Coin, both directions) ────────────────────────────────
type SwapHistoryItem = { id: number; direction: string; gram_amount: number; coins_amount: number; created_at: string };

function SwapPanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useLanguage();
  const { holdingWallet, sessionEarnings } = useWallet();
  const totalGram = holdingWallet + sessionEarnings;

  const [inputVal, setInputVal] = useState('');
  const [rate, setRate] = useState<number | null>(null);
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'ok' | 'err'; msg: string }>({ type: 'idle', msg: '' });
  const [history, setHistory] = useState<SwapHistoryItem[]>([]);

  const loadHistory = () => {
    const initData = getInitData();
    if (!initData) return;
    cachedFetch(`${API_BASE}/api/telegram/swap/history`, { headers: { 'x-init-data': initData } })
      .then(r => r.ok ? r.json() : [])
      .then((d: SwapHistoryItem[]) => { if (Array.isArray(d)) setHistory(d); })
      .catch(() => {});
  };

  useEffect(() => {
    const initData = getInitData();
    if (!initData) { setRate(700); return; }
    cachedFetch(`${API_BASE}/api/telegram/swap/rate`, { headers: { 'x-init-data': initData } })
      .then(r => r.ok ? r.json() : null)
      .then((d: { gramToCoins?: number } | null) => setRate(d?.gramToCoins ?? 700))
      .catch(() => setRate(700));

    loadHistory();
  }, []);

  const gramToCoinsRate = rate ?? 700;
  const inputNum = parseFloat(inputVal) || 0;
  const outputNum = Math.floor(inputNum * gramToCoinsRate);
  const fromBalance = `${totalGram.toFixed(4)} GRAM`;

  const handleSwap = async () => {
    if (!inputNum || inputNum <= 0) return;
    setStatus({ type: 'loading', msg: '' });
    try {
      await telegramApiPost<{ ok: boolean }>('/telegram/swap', {
        direction: 'gram_to_coins',
        amount: inputNum,
      });
      setStatus({ type: 'ok', msg: t('swap_success') });
      setInputVal('');
      loadHistory();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ type: 'err', msg: `❌ ${msg}` });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'linear-gradient(180deg,#1b1730 0%,#100d1c 100%)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-8 pb-4 border-b border-violet-500/20">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center text-white hover:bg-violet-500/30 transition-colors text-lg font-bold"
        >‹</button>
        <h2 className="text-lg font-black text-white">{t('swap_gram_to_coin')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-24 space-y-4">
        {/* Rate info */}
        <div className="bg-primary/10 border border-primary/30 rounded-2xl p-4 text-center">
          <div className="text-primary font-black text-lg">1 GRAM = {gramToCoinsRate.toLocaleString()} {t('unit_coin')}</div>
          <div className="text-xs text-white/60 mt-1">{t('swap_rate')}</div>
        </div>

        {/* From */}
        <div className="bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground font-bold uppercase">{t('swap_from')}</span>
            <span className="text-xs text-muted-foreground">{t('swap_balance')}: {fromBalance}</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={inputVal}
              onChange={e => { setInputVal(e.target.value); setStatus({ type: 'idle', msg: '' }); }}
              placeholder="0.00"
              className="flex-1 bg-transparent text-2xl font-black text-white outline-none"
              dir="ltr"
            />
            <div className="bg-primary/20 border border-primary/40 rounded-xl px-3 py-1.5">
              <span className="text-primary font-black text-sm">GRAM</span>
            </div>
          </div>
        </div>

        {/* Direction indicator (one-way: GRAM → coin) */}
        <div className="flex justify-center">
          <div className="w-11 h-11 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
            <ArrowDown className="w-5 h-5" />
          </div>
        </div>

        {/* To */}
        <div className="bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4 space-y-2">
          <div className="text-xs text-muted-foreground font-bold uppercase">{t('swap_to')}</div>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-2xl font-black text-white/70">
              {inputNum > 0 ? outputNum.toLocaleString() : '0'}
            </div>
            <div className="bg-white/10 border border-white/20 rounded-xl px-3 py-1.5">
              <span className="text-white font-black text-sm">{t('unit_coin')}</span>
            </div>
          </div>
        </div>

        {/* Status */}
        {status.msg && (
          <div className={`text-sm font-medium text-center p-3 rounded-xl ${
            status.type === 'ok' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
            status.type === 'err' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : ''
          }`}>
            {status.msg}
          </div>
        )}

        {/* Confirm */}
        <button
          onClick={handleSwap}
          disabled={status.type === 'loading' || !inputNum || inputNum <= 0}
          className="w-full py-4 rounded-2xl bg-primary text-black font-black text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
        >
          {status.type === 'loading' ? t('swap_converting') : `🔄 ${t('swap_gram_to_coin')}`}
        </button>

        {/* History */}
        {history.length > 0 && (
          <div className="space-y-2 pb-4">
            <div className="text-xs text-muted-foreground font-bold uppercase tracking-widest">{t('swap_history')}</div>
            {history.map(h => (
              <div key={h.id} className="bg-black/40 border border-violet-500/15 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="font-bold text-white text-sm">
                    {h.direction === 'gram_to_coins'
                      ? `${h.gram_amount} GRAM → ${h.coins_amount.toLocaleString()} ${t('unit_coin')}`
                      : `${h.coins_amount.toLocaleString()} ${t('unit_coin')} → ${h.gram_amount} GRAM`}
                  </div>
                  <div className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleDateString(lang)}</div>
                </div>
                <ArrowLeftRight className="w-4 h-4 text-primary" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Deposit Panel ────────────────────────────────────────────────────────────
// TON Connect direct payment — user pays gram to the bot's wallet and it's
// credited automatically (no TX Hash / admin approval needed).
type PayConfig = {
  depositWallet: string | null;
  minDeposit: number;
  minWithdraw: number;
  gramToCoins: number;
  autoPayout: boolean;
};

function usePayConfig() {
  const [cfg, setCfg] = useState<PayConfig | null>(null);
  useEffect(() => {
    cachedFetch(`${API_BASE}/api/telegram/deposit/config`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: PayConfig | null) => { if (d) setCfg(d); })
      .catch(() => {});
  }, []);
  return cfg;
}
function DepositPanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useLanguage();
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const cfg = usePayConfig();
  const { syncBalance } = useWallet();
  const { refreshBalance } = useCoins();
  const minDeposit = cfg?.minDeposit ?? 1;


  // Pre-fill from store navigation (set by Miners.tsx via sessionStorage)
  const prefillAmt = sessionStorage.getItem('_deposit_prefill') ?? '';
  if (prefillAmt) sessionStorage.removeItem('_deposit_prefill');

  const [amount, setAmount] = useState(prefillAmt);
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'ok' | 'err'; msg: string }>({ type: 'idle', msg: '' });
  const [history, setHistory] = useState<{ id: number; amount: number; status: string; created_at: string }[]>([]);
  const [showConnectNote, setShowConnectNote] = useState(false);

  const connected = Boolean(tonWallet?.account?.address);
  const amtNum = parseFloat(amount) || 0;

  useEffect(() => {
    const initData = getInitData();
    if (!initData) return;
    cachedFetch(`${API_BASE}/api/telegram/deposit/status`, { headers: { 'x-init-data': initData } })
      .then(r => r.ok ? r.json() : [])
      .then((d: { id: number; amount: number; status: string; created_at: string }[]) => {
        if (Array.isArray(d)) setHistory(d.slice(0, 10));
      })
      .catch(() => {});
  }, []);

  // If user just connected wallet after tapping "Connect", auto-proceed is handled by
  // watching connected state — UX: just show the Pay button, user taps again.
  useEffect(() => {
    if (connected) setShowConnectNote(false);
  }, [connected]);

  const handlePay = async () => {
    if (!amtNum || amtNum <= 0) return;

    if (!connected) {
      setShowConnectNote(true);
      tonConnectUI.openModal();
      return;
    }

    if (amtNum < minDeposit) {
      setStatus({ type: 'err', msg: `❌ ${t('min_label')} ${minDeposit} GRAM` });
      return;
    }

    const toAddress = cfg?.depositWallet ?? undefined;
    if (!toAddress || toAddress.startsWith('0:0000')) {
      setStatus({ type: 'err', msg: t('deposit_no_bot_wallet') });
      return;
    }

    setStatus({ type: 'loading', msg: '' });
    let requestId: number | null = null;
    let paymentSent = false;
    try {
      // Save the exact intent before opening the wallet. If Telegram/the app is
      // backgrounded after payment, the minute-by-minute scanner can still find it.
      const prepared = await telegramApiPost<{ ok: boolean; requestId?: number; message?: string }>(
        '/telegram/deposit/tonconnect',
        { action: 'prepare', amountGram: amtNum, from: tonWallet?.account?.address },
      );
      if (!prepared.ok || !prepared.requestId) {
        throw new Error(prepared.message ?? t('deposit_failed'));
      }
      requestId = prepared.requestId;

      // amtNum gram → nanotons (1 gram = 1 TON = 1e9 nanoton on TON chain)
      const nanotons = BigInt(Math.round(amtNum * 1e9));

      const result = await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
          address: toAddress,
          amount: nanotons.toString(),
          // No payload — TON Connect doesn't accept plain base64 text.
          // The backend identifies the deposit from the signed BOC (result.boc) below.
        }],
      });
      paymentSent = true;

      // Submit BOC to backend — backend credits gram balance automatically
      const data = await telegramApiPost<{ ok: boolean; pending?: boolean; balance?: number; message?: string }>(
        '/telegram/deposit/tonconnect',
        {
          action: 'confirm',
          requestId,
          boc: result.boc,
          amountGram: amtNum,
          from: tonWallet?.account?.address,
        },
      );

      if (data.ok || data.pending) {
        setStatus({ type: 'ok', msg: data.message ?? t('deposit_success', { amount: amtNum.toFixed(4) }) });
        setAmount('');
        // Instantly reflect the new balances in the app (no manual refresh).
        if (Number.isFinite(Number(data.balance))) syncBalance(Number(data.balance));
        notifyDataChange('wallet', 'balance');
        refreshBalance().catch(() => undefined);
        // The transfer may confirm a few seconds later — keep polling briefly.
        for (const delay of [4000, 9000, 15000, 25000]) {
          setTimeout(() => { refreshBalance().catch(() => undefined); }, delay);
        }
        const reloadHistory = () => {
          const initData = getInitData();
          if (!initData) return;
          cachedFetch(`${API_BASE}/api/telegram/deposit/status`, { headers: { 'x-init-data': initData } }, { force: true })
            .then(r => r.ok ? r.json() : [])
            .then((d: { id: number; amount: number; status: string; created_at: string }[]) => {
              if (Array.isArray(d)) setHistory(d.slice(0, 10));
            }).catch(() => {});
        };
        reloadHistory();
        setTimeout(reloadHistory, 8000);
        setTimeout(reloadHistory, 20000);
      } else {

        setStatus({ type: 'err', msg: `❌ ${data.message ?? t('deposit_failed')}` });
      }
    } catch (e: unknown) {
      if (requestId && !paymentSent) {
        telegramApiPost('/telegram/deposit/tonconnect', {
          action: 'cancel',
          requestId,
        }).catch(() => undefined);
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('User rejected') || msg.includes('reject') || msg.includes('cancel')) {
        setStatus({ type: 'err', msg: t('cancelled') });
      } else {
        setStatus({ type: 'err', msg: `❌ ${msg}` });
      }
    }
  };

  const statusColor = (s: string) =>
    s === 'confirmed' ? 'text-green-400' : s === 'rejected' ? 'text-red-400' : 'text-yellow-400';
  const statusLabel = (s: string) =>
    s === 'confirmed' ? t('status_confirmed') : s === 'rejected' ? t('status_rejected') : t('status_pending');

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'linear-gradient(180deg,#1b1730 0%,#100d1c 100%)' }}>
      <div className="flex items-center gap-3 px-4 pt-8 pb-4 border-b border-violet-500/20">
        <button onClick={onClose} className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center text-white hover:bg-violet-500/30 transition-colors text-lg font-bold">‹</button>
        <h2 className="text-lg font-black text-white">{t('deposit_title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-24 space-y-4">
        {/* Wallet status */}
        <div className={`rounded-2xl p-4 border ${connected ? 'bg-green-500/10 border-green-500/30' : 'bg-violet-500/[0.07] border-violet-500/25'}`}>
          <div className="text-xs text-muted-foreground mb-1 font-bold">{t('deposit_wallet')}</div>
          {connected ? (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-green-400 font-mono text-sm">
                {shortFriendlyAddress(tonWallet?.account?.address)}
              </span>
            </div>
          ) : (
            <button
              onClick={() => { setShowConnectNote(true); tonConnectUI.openModal(); }}
              className="text-primary font-bold text-sm underline underline-offset-2"
            >
              {t('deposit_connect_ton')}
            </button>
          )}
        </div>

        {showConnectNote && !connected && (
          <div className="bg-primary/10 border border-primary/30 rounded-2xl p-3 text-sm text-primary/90 text-center">
            {t('deposit_connect_note')}
          </div>
        )}

        {/* Amount input */}
        <div className="bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4 space-y-2">
          <div className="text-xs text-muted-foreground font-bold uppercase">{t('deposit_amount_label')}</div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={amount}
              onChange={e => { setAmount(e.target.value); setStatus({ type: 'idle', msg: '' }); }}
              placeholder="0.00"
              className="flex-1 bg-transparent text-3xl font-black text-white outline-none"
              dir="ltr"
              min="0"
              step="0.01"
            />
            <div className="bg-primary/20 border border-primary/40 rounded-xl px-3 py-1.5">
              <span className="text-primary font-black text-sm">GRAM</span>
            </div>
          </div>
          {amtNum > 0 && (
            <div className="text-xs text-white/40">≈ {amtNum.toFixed(4)} GRAM</div>
          )}
          <div className="text-xs text-primary/70 font-bold">{t('min_label')} {minDeposit} GRAM</div>

        </div>

        {/* Status message */}
        {status.msg && (
          <div className={`text-sm font-medium text-center p-3 rounded-xl ${
            status.type === 'ok' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
            status.type === 'err' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : ''
          }`}>
            {status.msg}
          </div>
        )}

        {/* Pay button */}
        <button
          onClick={handlePay}
          disabled={status.type === 'loading' || amtNum <= 0}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white font-black text-base shadow-[0_0_20px_rgba(139,92,246,0.35)] disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
        >
          {status.type === 'loading'
            ? t('deposit_processing')
            : !connected
              ? t('deposit_connect_and_deposit')
              : amtNum > 0
                ? t('deposit_amount_btn', { amount: amtNum.toFixed(4) })
                : t('deposit_btn')}
        </button>

        {/* Info footer */}
        <div className="bg-black/30 border border-violet-500/15 rounded-2xl p-4">
          <div className="grid grid-cols-2 gap-y-2 text-xs text-gray-400">
            <span>{t('deposit_payment_method')}</span>
            <span className="text-right text-blue-400 font-bold">TON Connect</span>
            <span>{t('deposit_crediting')}</span>

            <span className="text-right text-green-400">{t('deposit_crediting_auto')}</span>
            <span>1 GRAM</span>
            <span className="text-right text-primary font-bold">= 1 GRAM</span>
          </div>
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="space-y-2 pb-4">
            <div className="text-xs text-muted-foreground font-bold uppercase tracking-widest">{t('deposit_history')}</div>
            {history.map(h => (
              <div key={h.id} className="bg-black/40 border border-violet-500/15 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="font-bold text-white text-sm">{Number(h.amount).toFixed(4)} GRAM</div>
                  <div className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleDateString(lang)}</div>
                </div>
                <div className={`text-xs font-bold ${statusColor(h.status)}`}>{statusLabel(h.status)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Withdraw Panel ───────────────────────────────────────────────────────────
function WithdrawPanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useLanguage();
  const { holdingWallet, walletAddress, syncBalance } = useWallet();
  const cfg = usePayConfig();
  const minWithdraw = cfg?.minWithdraw ?? 0.1;
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'ok' | 'err'; msg: string }>({ type: 'idle', msg: '' });
  const [history, setHistory] = useState<{ id: number; amount: number; status: string; created_at: string }[]>([]);

  useEffect(() => {
    const initData = getInitData();
    if (!initData) return;
    cachedFetch(`${API_BASE}/api/telegram/withdraw/status`, { headers: { 'x-init-data': initData } })
      .then(r => r.ok ? r.json() : [])
      .then((d: { id: number; amount: number; status: string; created_at: string }[]) => {
        if (Array.isArray(d)) setHistory(d);
      })
      .catch(() => {});
  }, []);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    if (amt < minWithdraw) {
      setStatus({ type: 'err', msg: `❌ ${t('min_label')} ${minWithdraw} GRAM` });
      return;
    }
    // Optimistic UI: show the request as pending immediately, then reconcile
    // with the server response in the background.
    const tempId = -Date.now();
    setStatus({ type: 'loading', msg: '' });
    setHistory(prev => [
      { id: tempId, amount: amt, status: 'pending', created_at: new Date().toISOString() },
      ...prev,
    ]);
    setAmount('');
    try {
      const data = await telegramApiPost<{ ok: boolean; message: string; balance?: number }>('/telegram/withdraw', { amount: amt });
      const nextBalance = Number(data.balance);
      if (Number.isFinite(nextBalance)) syncBalance(nextBalance);
      setStatus({ type: 'ok', msg: data.message || t('withdraw_submitted') });
      invalidateApi('/api/telegram/withdraw/status');
      notifyDataChange('wallet', 'balance');
      const initData = getInitData();
      if (initData) {
        const response = await cachedFetch(
          `${API_BASE}/api/telegram/withdraw/status`,
          { headers: { 'x-init-data': initData } },
          { force: true },
        );
        if (response.ok) {
          const rows = await response.json() as typeof history;
          if (Array.isArray(rows)) setHistory(rows);
        }
      }
    } catch (e: unknown) {
      // Roll back the optimistic row when the request truly failed.
      setHistory(prev => prev.filter(h => h.id !== tempId));
      setAmount(String(amt));
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ type: 'err', msg: `❌ ${msg}` });
    }
  };


  const statusColor = (s: string) =>
    s === 'approved' ? 'text-green-400' : s === 'rejected' ? 'text-red-400' : 'text-yellow-400';
  const statusLabel = (s: string) =>
    s === 'approved' ? t('status_approved') : s === 'rejected' ? t('status_rejected') : t('status_pending');

  const body = (
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-24 space-y-4">

        {/* Wallet address */}
        <div className="bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4">
          <div className="text-xs text-muted-foreground mb-1 font-bold">{t('withdraw_linked_wallet')}</div>
          {walletAddress ? (
            <div className="font-mono text-sm text-white/80 break-all">{toFriendlyAddress(walletAddress)}</div>
          ) : (
            <div className="text-red-400 text-sm font-medium">{t('withdraw_no_wallet')}</div>
          )}
        </div>

        {/* Balance */}
        <div className="bg-primary/10 border border-primary/30 rounded-2xl p-4 text-center">
          <div className="text-xs text-white/60 mb-1">{t('withdraw_available')}</div>
          <div className="text-3xl font-black text-primary">{holdingWallet.toFixed(4)} GRAM</div>
        </div>

        {/* Amount input */}
        <div className="bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4 space-y-3">
          <div className="text-xs text-muted-foreground font-bold uppercase">{t('withdraw_amount_label')}</div>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent text-2xl font-black text-white outline-none"
            dir="ltr"
          />
          <button
            onClick={() => setAmount(holdingWallet.toFixed(4))}
            className="text-xs text-primary font-bold hover:underline"
          >
            {t('withdraw_max')} ({holdingWallet.toFixed(4)} GRAM)
          </button>
          <div className="text-xs text-primary/70 font-bold">{t('min_label')} {minWithdraw} GRAM</div>

        </div>

        {/* Status message */}
        {status.msg && (
          <div className={`text-sm font-medium text-center p-3 rounded-xl ${
            status.type === 'ok' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
            status.type === 'err' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : ''
          }`}>
            {status.msg}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={submit}
          disabled={status.type === 'loading' || !walletAddress || !amount}
          className="w-full py-4 rounded-2xl bg-primary text-black font-black text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
        >
          {status.type === 'loading' ? t('withdraw_sending') : t('withdraw_request_btn')}
        </button>

        {/* History */}
        {history.length > 0 && (
          <div className="space-y-2 pb-4">
            <div className="text-xs text-muted-foreground font-bold uppercase tracking-widest">{t('withdraw_history')}</div>
            {history.map(h => (
              <div key={h.id} className="bg-black/40 border border-violet-500/15 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="font-bold text-white text-sm">{Number(h.amount).toFixed(4)} GRAM</div>
                  <div className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleDateString(lang)}</div>
                </div>
                <div className={`text-xs font-bold ${statusColor(h.status)}`}>{statusLabel(h.status)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
  );

  if (embedded) return body;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'linear-gradient(180deg,#1b1730 0%,#100d1c 100%)' }}>
      <div className="flex items-center gap-3 px-4 pt-8 pb-4 border-b border-violet-500/20">
        <button onClick={onClose} className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center text-white hover:bg-violet-500/30 transition-colors text-lg font-bold">‹</button>
        <h2 className="text-lg font-black text-white">{t('withdraw_title')}</h2>
      </div>
      {body}
    </div>
  );

}

// ─── Main Profile Page ────────────────────────────────────────────────────────
const SUPPORT_ACCOUNT = 'GramMiner_Support';

function openSupportChat() {
  const url = `https://t.me/${SUPPORT_ACCOUNT}`;
  const tg = window.Telegram?.WebApp as { openTelegramLink?: (u: string) => void } | undefined;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, '_blank');
}

function SupportPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const [view, setView] = useState<'menu' | 'pick' | 'form'>('menu');
  const [kind, setKind] = useState<'complaint' | 'suggestion'>('complaint');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'ok' | 'err'; msg: string }>({ type: 'idle', msg: '' });

  const submit = async () => {
    if (!text.trim()) return;
    setStatus({ type: 'loading', msg: '' });
    try {
      await telegramApiPost<{ ok: boolean }>('/support/submit', { kind, message: text.trim() });
      setStatus({ type: 'ok', msg: t('support_sent') });
      setText('');
    } catch (e: unknown) {
      setStatus({ type: 'err', msg: e instanceof Error ? e.message : t('support_send_failed') });
    }
  };

  const back = () => {
    if (view === 'form') { setView('pick'); setStatus({ type: 'idle', msg: '' }); }
    else if (view === 'pick') setView('menu');
    else onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'linear-gradient(180deg,#1b1730 0%,#100d1c 100%)' }}>
      <div className="flex items-center gap-3 px-4 pt-8 pb-4 border-b border-violet-500/20">
        <button
          onClick={back}
          className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center text-white hover:bg-violet-500/30 transition-colors text-lg font-bold"
        >‹</button>
        <h2 className="text-lg font-black text-white">{t('support_title')}</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-24 space-y-3">
        {view === 'menu' && (
          <>
            <button
              onClick={() => setView('pick')}
              className="w-full bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4 flex items-center gap-4 text-right hover:bg-white/10 transition-colors"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
                <StickerBadge size={30} src={supportBalloonSticker.url} />
              </div>
              <div className="flex-1">
                <div className="font-bold text-white mb-0.5">{t('support_complaints')}</div>
                <div className="text-xs text-muted-foreground">{t('support_complaints_desc')}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>

            <button
              onClick={openSupportChat}
              className="w-full bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4 flex items-center gap-4 text-right hover:bg-white/10 transition-colors"
            >
              <div className="w-11 h-11 rounded-xl bg-success/15 flex items-center justify-center text-success">
                <Headphones className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-white mb-0.5">{t('support_direct')}</div>
                <div className="text-xs text-muted-foreground">{t('support_direct_desc', { account: SUPPORT_ACCOUNT })}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </>
        )}

        {view === 'pick' && (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">{t('support_pick_type')}</p>
            <button
              onClick={() => { setKind('complaint'); setView('form'); }}
              className="w-full bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4 flex items-center gap-4 text-right hover:bg-white/10 transition-colors"
            >
              <div className="w-11 h-11 rounded-xl bg-destructive/15 flex items-center justify-center text-destructive">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div className="flex-1 font-bold text-white">{t('support_complaint')}</div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={() => { setKind('suggestion'); setView('form'); }}
              className="w-full bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4 flex items-center gap-4 text-right hover:bg-white/10 transition-colors"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
                <Lightbulb className="w-5 h-5" />
              </div>
              <div className="flex-1 font-bold text-white">{t('support_suggestion')}</div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          </>
        )}

        {view === 'form' && (
          <>
            <div className="text-sm font-bold text-white">
              {kind === 'complaint' ? t('support_write_complaint') : t('support_write_suggestion')}
            </div>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setStatus({ type: 'idle', msg: '' }); }}
              maxLength={1000}
              rows={7}
              placeholder={t('support_placeholder')}
              className="w-full bg-violet-500/[0.07] border border-violet-500/25 rounded-2xl p-4 text-white text-sm outline-none focus:border-primary/50 resize-none select-text"
            />
            <div className="text-[10px] text-muted-foreground text-left">{text.length}/1000</div>
            <button
              onClick={submit}
              disabled={!text.trim() || status.type === 'loading'}
              className="w-full py-4 rounded-2xl bg-primary text-black font-black disabled:opacity-40"
            >
              {status.type === 'loading' ? t('support_sending') : t('support_send')}
            </button>
            {status.msg && (
              <div className={`text-center text-sm font-bold ${status.type === 'ok' ? 'text-success' : 'text-destructive'}`}>
                {status.msg}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Profile() {
  const { minerLevel, walletAddress } = useWallet();
  const { user: tgUser, avatarUrl } = useTelegramUser();
  const { lang, setLang, t } = useLanguage();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [showWalletHub, setShowWalletHub] = useState(false);

  const [showSettings, setShowSettings] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showSupport, setShowSupport] = useState(false);

  // Auto-open deposit panel if navigated from store (sessionStorage set by Miners.tsx)
  useEffect(() => {
    const amt = sessionStorage.getItem('deposit_amount');
    if (amt) {
      sessionStorage.removeItem('deposit_amount');
      setShowDeposit(true);
      // Pass amount to DepositPanel via ref storage — component reads it on mount
      sessionStorage.setItem('_deposit_prefill', amt);
    }
  }, []);

  function handleLangSelect(value: Lang) {
    setLang(value);
    setTimeout(() => setShowSettings(false), 400);
  }

  const userName = tgUser?.first_name
    ? `${tgUser.first_name}${tgUser.last_name ? ` ${tgUser.last_name}` : ''}`
    : 'Miner';
  const userInitial = userName[0].toUpperCase();
  const showAvatar = Boolean(avatarUrl) && !avatarFailed;

  const shortAddr = walletAddress
    ? shortFriendlyAddress(walletAddress)
    : null;

  return (
    <div className="min-h-full flex flex-col relative w-full px-4 pt-6">
      <div className="absolute inset-0 z-0" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} />

      {/* ── User info ── */}
      <div className="relative z-10 flex flex-col items-center mt-2 mb-8">
        <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary/50 relative mb-5 shadow-[0_0_20px_rgba(245,166,35,0.2)] overflow-hidden">
          {showAvatar ? (
            <img src={avatarUrl!} alt={userName} className="w-full h-full object-cover" onError={() => setAvatarFailed(true)} />
          ) : (
            <span className="font-black text-4xl text-primary">{userInitial}</span>
          )}
          <div className="absolute bottom-0 right-0 w-6 h-6 bg-success rounded-full border-2 border-background shadow-[0_0_10px_rgba(0,255,136,0.5)]" />
        </div>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-black text-white tracking-tight">{userName}</h1>
          <StickerBadge src={capWingsSticker.url} size={30} />
        </div>

        <div className="text-sm text-primary font-bold mt-1">
          {tgUser?.username ? `@${tgUser.username}` : `ID: ${tgUser?.id ?? '—'}`}
        </div>
        <div className="px-4 py-1.5 rounded-full bg-violet-500/[0.07] border border-violet-500/25 text-xs font-medium mt-4 flex flex-col items-center gap-0.5">
          {walletAddress ? (
            <>
              <span className="text-success font-semibold">{t('profile_connected')}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{shortAddr}</span>
            </>
          ) : (
            <span className="text-destructive/80">{t('profile_not_connected')}</span>
          )}
        </div>
      </div>

      {/* ── Menu cards ── */}
      <div className="relative z-10 flex-1 space-y-3 pb-40">
        {/* Wallet (connect + deposit/withdraw hub) */}
        <div
          onClick={() => (walletAddress ? setShowWalletHub(true) : setShowWallet(true))}
          className="bg-[#171522]/85 backdrop-blur-sm border border-violet-500/25 rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:bg-[#201b36]/90 transition-colors"
        >
          <div className="w-12 h-12 rounded-xl bg-violet-500/15 flex items-center justify-center text-white">
            <StickerBadge size={32} src={walletSticker.url} />
          </div>
          <div className="flex-1">
            <div className="font-bold text-white mb-0.5">Wallet</div>
            <div className="text-xs text-muted-foreground">
              {walletAddress ? `${t('deposit_title')} • ${t('profile_withdraw')}` : t('profile_wallet_desc')}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>


        {/* Swap */}
        <div
          onClick={() => setShowSwap(true)}
          className="bg-[#171522]/85 backdrop-blur-sm border border-violet-500/25 rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:bg-[#201b36]/90 transition-colors"
        >
          <div className="w-12 h-12 rounded-xl bg-violet-500/15 flex items-center justify-center text-white">
            <StickerBadge size={30} src={swapSticker.url} />
          </div>
          <div className="flex-1">
            <div className="font-bold text-white mb-0.5">{t('profile_swap')}</div>
            <div className="text-xs text-muted-foreground">{t('profile_swap_desc')}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* Settings */}
        <div
          onClick={() => setShowSettings(true)}
          className="bg-[#171522]/85 backdrop-blur-sm border border-violet-500/25 rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:bg-[#201b36]/90 transition-colors"
        >
          <div className="w-12 h-12 rounded-xl bg-violet-500/15 flex items-center justify-center text-white">
            <StickerBadge size={32} src={gearSticker.url} />
          </div>
          <div className="flex-1">
            <div className="font-bold text-white mb-0.5">{t('profile_settings')}</div>
            <div className="text-xs text-muted-foreground">{t('profile_settings_desc')}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* Support */}
        <div
          onClick={() => setShowSupport(true)}
          className="bg-[#171522]/85 backdrop-blur-sm border border-violet-500/25 rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:bg-[#201b36]/90 transition-colors"
        >
          <div className="w-12 h-12 rounded-xl bg-violet-500/15 flex items-center justify-center text-white">
            <StickerBadge size={32} src={supportBalloonSticker.url} />
          </div>
          <div className="flex-1">
            <div className="font-bold text-white mb-0.5">{t('support_complaints')}</div>
            <div className="text-xs text-muted-foreground">{t('support_complaints_desc')}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* FAQ */}

        <Link
          to="/faq"
          className="bg-[#171522]/85 backdrop-blur-sm border border-violet-500/25 rounded-2xl p-4 flex items-center gap-4 cursor-pointer hover:bg-[#201b36]/90 transition-colors"
        >
          <div className="w-12 h-12 rounded-xl bg-violet-500/15 flex items-center justify-center text-violet-300">
            <HelpCircle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-white mb-0.5">{t('faq_title')}</div>
            <div className="text-xs text-muted-foreground">{t('faq_desc')}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </Link>
      </div>

      {/* ── Modals / Panels ── */}
      {showWallet   && (
        <WalletModal
          onClose={() => {
            setShowWallet(false);
            if (walletAddress) setShowWalletHub(true);
          }}
        />
      )}
      {showWalletHub && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'linear-gradient(180deg,#1b1730 0%,#100d1c 100%)' }}>
          <div className="flex items-center gap-3 px-4 pt-8 pb-4 border-b border-violet-500/20">
            <button
              onClick={() => setShowWalletHub(false)}
              className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center text-white hover:bg-violet-500/30 transition-colors text-lg font-bold"
            >‹</button>
            <h2 className="text-lg font-black text-white">Wallet</h2>
          </div>

          <div className="px-4 py-4">
            <div className="rounded-2xl bg-violet-500/[0.07] border border-violet-500/25 p-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-bold uppercase">{t('profile_wallet_connection')}</span>
              <span className="font-mono text-[11px] text-white">{shortAddr ?? '—'}</span>
            </div>
          </div>

          {/* Tabs: Deposit / Withdraw */}
          <div className="px-4">
            <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-violet-500/[0.07] border border-violet-500/25">
              {(['deposit', 'withdraw'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setWalletTab(tab)}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-black transition-colors ${
                    walletTab === tab ? 'bg-primary text-black' : 'text-white/70 hover:bg-violet-500/15'
                  }`}
                >
                  <StickerBadge size={20} src={tab === 'deposit' ? downloadSticker.url : purseSticker.url} />
                  {tab === 'deposit' ? t('deposit_title') : t('profile_withdraw')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            {walletTab === 'deposit'
              ? <DepositPanel embedded onClose={() => setShowWalletHub(false)} />
              : <WithdrawPanel embedded onClose={() => setShowWalletHub(false)} />}
          </div>

        </div>
      )}
      {showSwap     && <SwapPanel onClose={() => setShowSwap(false)} />}
      {showWithdraw && <WithdrawPanel onClose={() => setShowWithdraw(false)} />}
      {showDeposit  && <DepositPanel onClose={() => setShowDeposit(false)} />}
      {showSupport  && <SupportPanel onClose={() => setShowSupport(false)} />}

      {/* ── Settings Panel ── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'linear-gradient(180deg,#1b1730 0%,#100d1c 100%)' }}>
          <div className="flex items-center gap-3 px-4 pt-8 pb-4 border-b border-violet-500/20">
            <button
              onClick={() => setShowSettings(false)}
              className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center text-white hover:bg-violet-500/30 transition-colors text-lg font-bold"
            >‹</button>
            <h2 className="text-lg font-black text-white">{t('profile_settings')}</h2>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pt-6 pb-24">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              {t('profile_language_label')}
            </p>
            <div className="space-y-2">
              {SUPPORTED_LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  onClick={() => handleLangSelect(l.value as Lang)}
                  className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-colors ${
                    lang === l.value
                      ? 'bg-primary/15 border-primary/50 text-white'
                      : 'bg-violet-500/[0.07] border-violet-500/25 text-white/70 hover:bg-violet-500/15'
                  }`}
                >
                  {l.value === 'en' ? (
                    <StickerBadge size={28} src={flagUsSticker.url} />
                  ) : l.value === 'ar' ? (
                    <video
                      src={languageSticker.url}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-7 h-7 shrink-0 object-contain"
                    />
                  ) : l.value === 'ru' ? (
                    <StickerBadge size={28} src={flagRuSticker.url} />
                  ) : (
                    <span className="text-2xl">{l.flag}</span>
                  )}
                  <span className="flex-1 text-left font-semibold">{l.label}</span>
                  {lang === l.value && <Check className="w-5 h-5 text-primary" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
