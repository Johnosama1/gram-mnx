import { HelpCircle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useNavigate } from '@tanstack/react-router';

interface FAQItem {
  q: string;
  a: string;
}

/** Builds the FAQ list from the active language's translations. */
function useFaqs(t: (key: string) => string): FAQItem[] {
  return Array.from({ length: 14 }, (_, i) => ({
    q: t(`faq_q${i + 1}`),
    a: t(`faq_a${i + 1}`),
  }));
}

function FAQRow({ item, index }: { item: FAQItem; index: number }) {
  return (
    <div className="border border-violet-500/25 rounded-2xl overflow-hidden bg-card/85 backdrop-blur-sm">
      <div className="flex items-start gap-3 px-4 pt-4 text-right">
        <span className="w-6 h-6 shrink-0 rounded-lg bg-violet-500/20 text-violet-200 text-[11px] font-black flex items-center justify-center">
          {index + 1}
        </span>
        <span className="flex-1 text-sm font-bold text-foreground leading-relaxed">{item.q}</span>
      </div>
      <div className="px-4 pb-4 pt-3 mt-3 border-t border-violet-500/15">
        <p className="text-sm text-muted-foreground leading-relaxed text-right">{item.a}</p>
      </div>
    </div>
  );
}

export default function FAQ() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const FAQS = useFaqs(t);
  return (
    <div className="min-h-full flex flex-col relative w-full px-4 pt-6">
      <div className="absolute inset-0 z-0" style={{ background: 'linear-gradient(180deg, hsl(240 8% 5%) 0%, hsl(258 25% 8%) 100%)' }} />

      <div className="relative z-10 flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate({ to: '/profile' })}
          className="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center text-primary hover:bg-violet-500/30 transition-colors text-lg font-bold"
        >
          ‹
        </button>
        <h1 className="text-lg font-black text-foreground flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-violet-300" />
          {t('faq_title')}
        </h1>
      </div>

      <div className="relative z-10 flex-1 space-y-3 pb-28">
        {FAQS.map((item, idx) => (
          <FAQRow key={idx} item={item} index={idx} />
        ))}
      </div>
    </div>
  );
}
