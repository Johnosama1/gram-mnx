import { createFileRoute } from '@tanstack/react-router';
import { json } from '@/lib/admin.server';
import { getMinDeposit } from '@/lib/deposit.server';
import { getMinWithdraw } from '@/lib/withdraw.server';
import { getGramToCoins } from '@/lib/swap.server';
import { getDepositWallet, getPayoutWalletAddress, hasPayoutWallet, normalizeAddress } from '@/lib/ton.server';

export const Route = createFileRoute('/api/telegram/deposit/config')({
  server: {
    handlers: {
      GET: async () => {
        const depositWallet = getDepositWallet() ?? null;
        const payoutWallet = await getPayoutWalletAddress();
        const [depositRaw, payoutRaw] = await Promise.all([
          depositWallet ? normalizeAddress(depositWallet) : null,
          payoutWallet ? normalizeAddress(payoutWallet) : null,
        ]);
        return json({
          depositWallet,
          minDeposit: await getMinDeposit(),
          minWithdraw: await getMinWithdraw(),
          gramToCoins: await getGramToCoins(),
          autoPayout: (await hasPayoutWallet()) && Boolean(depositRaw && payoutRaw && depositRaw === payoutRaw),
          payoutWallet,
          walletsMatch: Boolean(depositRaw && payoutRaw && depositRaw === payoutRaw),
        });
      },
    },
  },
});
