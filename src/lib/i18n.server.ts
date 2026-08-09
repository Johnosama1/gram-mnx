/**
 * Server-side message catalog so every API response speaks the language the
 * user picked in the Mini App (sent as the `x-lang` header / `lang` body field).
 */

export type Lang = 'en' | 'ar' | 'ru';

const LANGS: Lang[] = ['en', 'ar', 'ru'];

type Entry = Record<Lang, string>;

const MESSAGES = {
  invalid_amount: {
    en: 'Invalid amount',
    ar: 'المبلغ غير صحيح',
    ru: 'Неверная сумма',
  },
  account_not_found: {
    en: 'Account not found',
    ar: 'الحساب غير موجود',
    ru: 'Аккаунт не найден',
  },
  banned: {
    en: 'Your account is banned',
    ar: 'حسابك محظور',
    ru: 'Ваш аккаунт заблокирован',
  },
  request_failed: {
    en: 'Request failed ({status})',
    ar: 'تعذر تنفيذ الطلب ({status})',
    ru: 'Не удалось выполнить запрос ({status})',
  },

  // ---- deposit ----
  min_deposit: {
    en: 'Minimum deposit is {min} GRAM',
    ar: 'أقل مبلغ للإيداع {min} GRAM',
    ru: 'Минимальный депозит — {min} GRAM',
  },
  deposit_wallet_missing: {
    en: 'Deposit wallet is not configured',
    ar: 'محفظة الإيداع غير مضبوطة',
    ru: 'Кошелёк для депозитов не настроен',
  },
  link_wallet_first: {
    en: 'Link your wallet first — deposits are only allowed from your linked wallet',
    ar: 'اربط محفظتك أولاً — الإيداع مسموح فقط من المحفظة المربوطة بحسابك',
    ru: 'Сначала привяжите кошелёк — депозиты принимаются только с привязанного кошелька',
  },
  linked_wallet_invalid: {
    en: 'The linked wallet address is invalid',
    ar: 'عنوان المحفظة المربوط غير صالح',
    ru: 'Адрес привязанного кошелька недействителен',
  },
  wallet_mismatch: {
    en: 'The connected wallet is not the wallet linked to your account — use the same address',
    ar: 'المحفظة المتصلة ليست نفس المحفظة المربوطة بحسابك — استخدم نفس العنوان',
    ru: 'Подключённый кошелёк не совпадает с привязанным — используйте тот же адрес',
  },
  banned_fraud: {
    en: 'Your account has been banned for repeated deposits from an unlinked wallet.',
    ar: 'تم حظر حسابك بسبب محاولات إيداع من محفظة غير مربوطة.',
    ru: 'Ваш аккаунт заблокирован за попытки депозита с непривязанного кошелька.',
  },
  onchain_insufficient: {
    en: 'Your on-chain wallet balance is too low ({onchain} TON). You need {amount} + {fee} fee.',
    ar: 'رصيد محفظتك على الشبكة غير كافٍ ({onchain} TON). تحتاج {amount} + {fee} رسوم.',
    ru: 'Недостаточно средств на кошельке ({onchain} TON). Нужно {amount} + {fee} комиссии.',
  },
  deposit_prepare_failed: {
    en: 'Could not prepare the deposit request, please try again',
    ar: 'تعذر تجهيز طلب الإيداع، حاول مرة أخرى',
    ru: 'Не удалось создать заявку на депозит, попробуйте снова',
  },
  deposit_request_invalid: {
    en: 'Invalid deposit request',
    ar: 'طلب الإيداع غير صالح',
    ru: 'Некорректная заявка на депозит',
  },
  deposit_no_transfer: {
    en: 'No transfer was sent from your wallet.',
    ar: 'لم يتم إرسال أي تحويل من محفظتك.',
    ru: 'С вашего кошелька не был отправлен перевод.',
  },
  deposit_link_failed: {
    en: 'Could not match the transfer to the deposit request',
    ar: 'تعذر ربط التحويل بطلب الإيداع',
    ru: 'Не удалось сопоставить перевод с заявкой на депозит',
  },
  deposit_confirmed: {
    en: '✅ Your deposit was received.\n💰 {coins} Coin added to your balance.',
    ar: '✅ تم استلام إيداعك بنجاح.\n💰 تمت إضافة {coins} Coin إلى رصيدك.',
    ru: '✅ Депозит получен.\n💰 На баланс начислено {coins} Coin.',
  },
  deposit_verifying: {
    en: '⏳ The transfer was sent and is being verified; your balance updates automatically once confirmed.',
    ar: '⏳ تم إرسال التحويل ويجري التحقق منه؛ سيُضاف الرصيد تلقائيًا بعد التأكيد.',
    ru: '⏳ Перевод отправлен и проверяется; баланс обновится автоматически после подтверждения.',
  },
  deposit_notify_pending: {
    en: '⏳ <b>Deposit request received</b>\nVerifying your transfer of {amount} GRAM on-chain.',
    ar: '⏳ <b>تم استلام طلب الإيداع</b>\nيجري الآن التحقق من تحويل {amount} GRAM على الشبكة.',
    ru: '⏳ <b>Заявка на депозит получена</b>\nПроверяем перевод {amount} GRAM в сети.',
  },
  deposit_cancelled_reason: {
    en: 'User cancelled the payment',
    ar: 'ألغى المستخدم عملية الدفع',
    ru: 'Пользователь отменил платёж',
  },

  // ---- swap ----
  swap_one_way: {
    en: 'Swapping coin back to GRAM is not available',
    ar: 'التحويل من coin إلى GRAM غير متاح',
    ru: 'Обмен coin обратно в GRAM недоступен',
  },
  swap_insufficient_gram: {
    en: 'Not enough GRAM balance',
    ar: 'رصيد الجرام غير كافٍ',
    ru: 'Недостаточно GRAM на балансе',
  },
  swap_amount_too_small: {
    en: 'Amount is too small',
    ar: 'المبلغ صغير جدًا',
    ru: 'Сумма слишком мала',
  },

  // ---- withdraw ----
  withdraw_restricted: {
    en: 'Withdrawals are disabled on your account',
    ar: 'السحب موقوف على حسابك',
    ru: 'Вывод средств отключён для вашего аккаунта',
  },
  withdraw_link_wallet: {
    en: 'Link your wallet first',
    ar: 'اربط محفظتك أولاً',
    ru: 'Сначала привяжите кошелёк',
  },
  withdraw_multi_account: {
    en: 'Withdrawal rejected: {shared} accounts registered from the same network address (limit {limit}).',
    ar: 'تم رفض السحب: تم تسجيل {shared} حساب من نفس عنوان الشبكة (الحد المسموح {limit}).',
    ru: 'Вывод отклонён: {shared} аккаунтов с одного сетевого адреса (лимит {limit}).',
  },
  withdraw_duplicate_wallet: {
    en: 'Withdrawal rejected: this address is used by {shared} accounts (limit {limit}).',
    ar: 'تم رفض السحب: هذا العنوان مستخدم من {shared} حساب (الحد المسموح {limit}).',
    ru: 'Вывод отклонён: этот адрес используют {shared} аккаунтов (лимит {limit}).',
  },
  withdraw_insufficient: {
    en: 'Insufficient balance: you have {balance} GRAM and requested {amount} GRAM',
    ar: 'الرصيد غير كافٍ: المتاح في حسابك {balance} GRAM والمطلوب {amount} GRAM',
    ru: 'Недостаточно средств: доступно {balance} GRAM, запрошено {amount} GRAM',
  },
  min_withdraw: {
    en: 'Minimum withdrawal is {min} GRAM',
    ar: 'أقل مبلغ للسحب {min} GRAM',
    ru: 'Минимальная сумма вывода — {min} GRAM',
  },
  withdraw_deduct_failed: {
    en: 'Could not deduct the balance, please try again',
    ar: 'تعذر خصم الرصيد، حاول مرة أخرى',
    ru: 'Не удалось списать баланс, попробуйте снова',
  },
  withdraw_create_failed: {
    en: 'Could not create the withdrawal request; your balance was restored',
    ar: 'تعذر إنشاء طلب السحب وتمت إعادة الرصيد',
    ru: 'Не удалось создать заявку на вывод; баланс возвращён',
  },
  withdraw_sent: {
    en: '✅ The amount was sent to your wallet',
    ar: '✅ تم إرسال المبلغ إلى محفظتك',
    ru: '✅ Сумма отправлена на ваш кошелёк',
  },
  withdraw_pending_admin: {
    en: '✅ Your request was sent to the admins and is pending',
    ar: '✅ تم إرسال طلبك إلى الإدارة وهو قيد الانتظار',
    ru: '✅ Заявка отправлена администрации и ожидает обработки',
  },
  withdraw_auto_failed: {
    en: 'Automatic GRAM transfer failed: {reason}. The amount was returned to your balance.',
    ar: 'تعذر تحويل GRAM تلقائيًا: {reason}. تمت إعادة المبلغ إلى رصيد حسابك.',
    ru: 'Автоматический перевод GRAM не удался: {reason}. Сумма возвращена на баланс.',
  },
  withdraw_submitted: {
    en: '✅ Your withdrawal request was submitted and is under review',
    ar: '✅ تم إرسال طلب السحب وهو قيد المراجعة',
    ru: '✅ Заявка на вывод отправлена и находится на рассмотрении',
  },

  // ---- wallet ----
  wallet_taken: {
    en: 'This wallet is already linked to another account',
    ar: 'هذه المحفظة مرتبطة بحساب آخر',
    ru: 'Этот кошелёк уже привязан к другому аккаунту',
  },
} satisfies Record<string, Entry>;

export type MessageKey = keyof typeof MESSAGES;

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as string[]).includes(v);
}

/** Resolves the caller's language from the `x-lang` header or request body. */
export function reqLang(request: Request, body?: { lang?: unknown }): Lang {
  if (isLang(body?.lang)) return body.lang;
  const header = request.headers.get('x-lang');
  if (isLang(header)) return header;
  return 'en';
}

export function tr(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const entry = MESSAGES[key] as Entry;
  let str = entry[lang] ?? entry.en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}
