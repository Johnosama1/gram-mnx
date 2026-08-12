import { HelpCircle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Link } from '@tanstack/react-router';

interface FAQItem {
  q: string;
  a: string;
}

const FAQS: FAQItem[] = [
  {
    q: 'ما هو GRAM MNX؟',
    a: 'GRAM MNX هو تطبيق تعدين صغير داخل تيليغرام. تستطيع تعدين عملة Gram عبر ضغطات يومية، إكمال المهام، دعوة الأصدقاء، وحضور مسابقات الهدايا.',
  },
  {
    q: 'ما الفرق بين GRAM و MNX؟',
    a: 'Gram هي العملة التي تعدينها داخل التطبيق. MNX هو رصيد التشغيل (MNX) الذي تحصل عليه من الإحالات والمهام، ويُستخدم لتحسين وتسريع عملية التعدين.',
  },
  {
    q: 'كيف أبدأ التعدين؟',
    a: 'افتح صفحة Mine الرئيسية، اضغط على الزر الخاص بالاستلام (Claim) بانتظام، واشترِ وحدات تعدين لزيادة معدل الإنتاج.',
  },
  {
    q: 'ما معنى Swap / التحويل؟',
    a: 'Swap يسمح لك بتحويل Gram إلى MNX أو العكس، حسب السعر الحالي داخل التطبيق.',
  },
  {
    q: 'كيف يتم السحب؟',
    a: 'اذهب إلى صفحة الملف الشخصي، اختر "سحب"، أدخل المبلغ والمحفظة المربوطة، ثم أرسل الطلب. يتم مراجعة السحب وإرساله يدويًا من قبل الأدمن.',
  },
  {
    q: 'لماذا يتأخر السحب أحيانًا؟',
    a: 'السحب يتم يدويًا بعد مراجعة الأدمن. التأخير قد يكون بسبب: ازدحام الشبكة، تجاوز الحد اليومي، عدم مطابقة المحفظة، أو وضع الصيانة.',
  },
  {
    q: 'كيف أودع داخل التطبيق؟',
    a: 'من صفحة الملف الشخصي اختر "إيداع". انسخ عنوان محفظة البوت، وأرسل مبلغ Gram من محفظتك. تتم الإضافة تلقائيًا بعد تأكيد الشبكة.',
  },
  {
    q: 'هل يمكن تسجيل الدخول بدون محفظة؟',
    a: 'نعم، يمكنك استخدام التطبيق باستخدام حساب Telegram فقط. لكن لتحويل وسحب الأموال يجب ربط محفظة GRAM.',
  },
  {
    q: 'ما هي كومبو اليوم؟',
    a: 'Combo هي لعبة يومية. عليك اختيار 3 عناصر صحيحة من بين 5 خيارات لإكمال الكومبو والفوز بمكافأة.',
  },
  {
    q: 'كيف أزيد فرصي في مسابقات الهدايا؟',
    a: 'كل دعوة لصديق عبر رابط الهدية تزيد فرصك في السحب. كلما دعوت أكثر، زادت احتمالية فوزك.',
  },
  {
    q: 'لماذا معدل التعدين يتغير؟',
    a: 'معدل التعدين يعتمد على عدد MNX لديك، ونسبة التعدين اليومية التي يحددها الأدمن. كلما زاد رصيدك، زاد الربح.',
  },
  {
    q: 'هل يمكن تعديل رصيدي أو نقله لحساب آخر؟',
    a: 'لا، الرصيد مرتبط بحساب Telegram الخاص بك. لا يمكن نقله أو تعديله إلا من قبل الأدمن.',
  },
  {
    q: 'ما هي رسوم السحب؟',
    a: 'قد تطبق رسوم شبكة بسيطة على عمليات السحب. الحد الأدنى للسحب والرسوم الحالية تظهر في صفحة السحب.',
  },
  {
    q: 'كيف أتواصل مع الدعم؟',
    a: 'من صفحة الملف الشخصي اختر "الدعم والشكاوى"، ثم اكتب رسالتك. سيتم الرد عليك في أقرب وقت.',
  },
];

function FAQRow({ item, index }: { item: FAQItem; index: number }) {
  return (
    <div className="border border-violet-500/25 rounded-2xl overflow-hidden bg-[#171522]/85 backdrop-blur-sm">
      <div className="flex items-start gap-3 px-4 pt-4 text-right">
        <span className="w-6 h-6 shrink-0 rounded-lg bg-violet-500/20 text-violet-200 text-[11px] font-black flex items-center justify-center">
          {index + 1}
        </span>
        <span className="flex-1 text-sm font-bold text-white leading-relaxed">{item.q}</span>
      </div>
      <div className="px-4 pb-4 pt-3 mt-3 border-t border-violet-500/15">
        <p className="text-sm text-white/75 leading-relaxed text-right">{item.a}</p>
      </div>
    </div>
  );
}

export default function FAQ() {
  const { t } = useLanguage();
  return (
    <div className="min-h-full flex flex-col relative w-full px-4 pt-6">
      <div className="absolute inset-0 z-0" style={{ background: 'linear-gradient(180deg,#1b1730 0%,#100d1c 100%)' }} />

      <div className="relative z-10 flex items-center gap-3 mb-6">
        <Link
          to="/profile"
          className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center text-white hover:bg-violet-500/30 transition-colors text-lg font-bold"
        >
          ‹
        </Link>
        <h1 className="text-lg font-black text-white flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-violet-300" />
          {t('faq_title')}
        </h1>
      </div>

      <div className="relative z-10 flex-1 space-y-3 pb-8">
        {FAQS.map((item, idx) => (
          <FAQRow key={idx} item={item} index={idx} />
        ))}
      </div>
    </div>
  );
}
