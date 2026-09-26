'use client';

import { Sparkles } from 'lucide-react';

export type DeepDiveLanguage = 'en' | 'ar';

export function DeepDiveLanguageChoice({
  onChoose,
}: {
  onChoose: (language: DeepDiveLanguage) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-10 sm:px-8">
      <div className="royal-deep-dive-chooser w-full max-w-[520px] text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-[18px] border border-[#c9a75f]/30 bg-[#c9a75f]/8 text-[#ad7d28] dark:text-[#e7c878]">
          <Sparkles className="h-5 w-5" />
        </div>
        <h3 className="mt-4 font-serif text-[24px] font-semibold tracking-[-0.025em] text-[#28231d] dark:text-white">
          How would you like your Deep Dive?
        </h3>
        <p className="mx-auto mt-2 max-w-[430px] text-[11.5px] leading-5 text-[#756e64] dark:text-white/48">
          Choose the teaching language for the first explanation. You can switch at any time,
          and follow-up replies adapt to the language you use.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChoose('en')}
            className="group rounded-2xl border border-black/10 bg-[#fffdf8] p-4 text-left shadow-[0_10px_30px_rgba(69,51,21,0.045)] transition hover:-translate-y-0.5 hover:border-[#c9a75f]/45 hover:shadow-[0_14px_34px_rgba(69,51,21,0.08)] dark:border-white/10 dark:bg-[#151d23]"
          >
            <span className="text-[8px] font-bold uppercase tracking-[0.13em] text-[#9a722d] dark:text-[#d9b86e]">
              MRCP Professor Mode
            </span>
            <span className="mt-1.5 block text-[16px] font-semibold text-[#2c271f] dark:text-white">
              English
            </span>
            <span className="mt-1.5 block text-[10px] leading-[18px] text-[#756e64] dark:text-white/45">
              Full English explanation with clinical reasoning, mechanisms, distractor analysis and exam strategy.
            </span>
            <span className="mt-3 block text-[10px] font-semibold text-[#a77929] dark:text-[#e4c274]">
              Continue in English →
            </span>
          </button>

          <button
            type="button"
            dir="rtl"
            onClick={() => onChoose('ar')}
            className="group rounded-2xl border border-black/10 bg-[#fffdf8] p-4 text-right shadow-[0_10px_30px_rgba(69,51,21,0.045)] transition hover:-translate-y-0.5 hover:border-[#c9a75f]/45 hover:shadow-[0_14px_34px_rgba(69,51,21,0.08)] dark:border-white/10 dark:bg-[#151d23]"
          >
            <span className="text-[8px] font-bold uppercase tracking-[0.13em] text-[#9a722d] dark:text-[#d9b86e]">
              Egyptian Education Mode
            </span>
            <span className="mt-1.5 block text-[16px] font-semibold text-[#2c271f] dark:text-white">
              عربي + Medical English
            </span>
            <span className="mt-1.5 block text-[10px] leading-[18px] text-[#756e64] dark:text-white/45">
              شرح مصري بسيط مع الحفاظ على المصطلحات الطبية المهمة بالإنجليزي زي ما هتشوفها في الامتحان.
            </span>
            <span className="mt-3 block text-[10px] font-semibold text-[#a77929] dark:text-[#e4c274]">
              ابدأ الشرح بالعربي ←
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
