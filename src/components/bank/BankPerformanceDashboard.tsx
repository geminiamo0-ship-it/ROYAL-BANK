import Link from 'next/link';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Flame,
  Info,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import type {
  BankActivityDay,
  BankPerformanceDifficulty,
  BankPerformanceSummary,
} from '@/lib/bank-performance';

function pct(value: number | null, digits = 0) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function ordinalParts(value: number) {
  const rounded = Math.round(value);
  const mod100 = Math.abs(rounded) % 100;
  let suffix = 'th';
  if (mod100 < 11 || mod100 > 13) {
    const mod10 = Math.abs(rounded) % 10;
    if (mod10 === 1) suffix = 'st';
    else if (mod10 === 2) suffix = 'nd';
    else if (mod10 === 3) suffix = 'rd';
  }
  return { value: rounded, suffix };
}

function difficultyLabel(value: string) {
  if (value === '1' || value.toLowerCase() === 'easy') return 'Easy';
  if (value === '3' || value.toLowerCase() === 'hard') return 'Hard';
  return 'Medium';
}

function difficultyMix(rows: BankPerformanceDifficulty[]) {
  const total = rows.reduce((sum, row) => sum + row.answered, 0);
  const valueFor = (label: string) => {
    if (total === 0) return 0;
    const row = rows.find((item) => difficultyLabel(item.difficulty) === label);
    return row ? Math.round((row.answered / total) * 100) : 0;
  };
  return { Easy: valueFor('Easy'), Medium: valueFor('Medium'), Hard: valueFor('Hard') };
}

export function BankHero({
  bankId,
  bankName,
  performance,
}: {
  bankId: number;
  bankName: string;
  performance: BankPerformanceSummary;
}) {
  const mix = difficultyMix(performance.difficulty);

  return (
    <section className="relative overflow-hidden rounded-[4px] bg-[#394046] px-[14px] py-[18px] shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
      <div
        className="absolute right-[-60px] top-0 h-full w-[410px] bg-[#2e6a55]/55"
        style={{ clipPath: 'polygon(35% 0, 100% 0, 100% 40%, 25% 100%, 0 100%, 18% 35%)' }}
      />
      <div
        className="absolute right-[88px] top-0 h-full w-[190px] bg-[#2b5b50]/70"
        style={{ clipPath: 'polygon(48% 0, 100% 100%, 0 100%)' }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-[24px] items-end gap-[3px]">
            <span className="h-[13px] w-[5px] bg-[#ff2020]" />
            <span className="h-[17px] w-[5px] bg-[#fff100]" />
            <span className="h-[22px] w-[5px] bg-[#47d41f]" />
          </span>
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-[#f2f2f2]">{bankName}</h1>
            <p className="mt-1 text-[11px] text-[#b9c4cb]">Live activity and performance from your saved answers</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/bank/${bankId}/sessions`} className="rounded-[4px] border border-[#71808c] bg-[#30373d] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#3a4248]">
            Previous sessions
          </Link>
          <Link href={`/bank/${bankId}/question-bank`} className="rounded-[4px] bg-[#d5e4ff] px-3 py-2 text-[11px] font-semibold text-[#102148] hover:bg-[#e2ecff]">
            Open question bank
          </Link>
        </div>
      </div>

      <div className="relative mt-[34px] grid gap-6 lg:grid-cols-[1fr_170px_1fr] lg:items-start">
        <ActivityHeatmap title="Practice activity" days={performance.activity} mode="volume" />

        <div className="flex flex-col items-center gap-[8px] pt-1">
          <StatPill tone="amber" value={`${performance.answered_today} today`} icon={<Target className="h-3 w-3" />} />
          <StatPill tone="green" value={`${performance.streak_days} day streak`} icon={<Flame className="h-3 w-3" />} />
          <StatPill tone="green" value={`${pct(performance.accuracy, 1)} accuracy`} icon={<BarChart3 className="h-3 w-3" />} />
          <div className="rounded-[4px] bg-[#ffd4c8] px-3 py-[4px] text-[10px] font-semibold text-[#8d3029]">
            Easy {mix.Easy}% · Medium {mix.Medium}% · Hard {mix.Hard}%
          </div>
        </div>

        <ActivityHeatmap title="Accuracy activity" days={performance.activity} mode="accuracy" />
      </div>
    </section>
  );
}

export function BankPerformanceDashboard({
  bankId,
  performance,
}: {
  bankId: number;
  performance: BankPerformanceSummary;
}) {
  const answered = performance.answered;
  const totalQuestions = performance.total_questions;
  const correctPct = answered > 0 ? (performance.correct / answered) * 100 : 0;
  const incorrectPct = answered > 0 ? (performance.incorrect / answered) * 100 : 0;
  const completionPct = totalQuestions > 0 ? clampPercent(performance.completion_percentage) : 0;
  const remainingQuestions = Math.max(0, totalQuestions - answered);
  const remainingPct = totalQuestions > 0 ? Math.max(0, 100 - completionPct) : 0;

  return (
    <div className="space-y-[14px]">
      <div className="grid gap-[14px] xl:grid-cols-2">
        <QuestionBankOverviewCard
          bankId={bankId}
          correct={performance.correct}
          incorrect={performance.incorrect}
          correctPct={correctPct}
          incorrectPct={incorrectPct}
          completed={answered}
          remaining={remainingQuestions}
          completionPct={completionPct}
          remainingPct={remainingPct}
          hasAnswers={answered > 0}
          hasQuestions={totalQuestions > 0}
        />

        <EstimatedPercentileCard
          percentile={performance.estimated_percentile}
          adjustedScore={performance.difficulty_adjusted_score}
          peerAverage={performance.peer_average}
        />
      </div>

      <CategoryPerformance performance={performance} />
    </div>
  );
}

function QuestionBankOverviewCard({
  bankId,
  correct,
  incorrect,
  correctPct,
  incorrectPct,
  completed,
  remaining,
  completionPct,
  remainingPct,
  hasAnswers,
  hasQuestions,
}: {
  bankId: number;
  correct: number;
  incorrect: number;
  correctPct: number;
  incorrectPct: number;
  completed: number;
  remaining: number;
  completionPct: number;
  remainingPct: number;
  hasAnswers: boolean;
  hasQuestions: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-[10px] border border-[#334654] bg-[#1e2d3a] shadow-[0_3px_10px_rgba(0,0,0,0.3)]">
      <CardHeader title="Question Bank" />

      <div className="px-5 pb-5 pt-4 sm:px-6">
        <h2 className="text-[16px] font-semibold text-white">Overview</h2>

        <MetricBlock title="Correct vs Incorrect">
          <SegmentedMetricBar
            leftPct={correctPct}
            rightPct={incorrectPct}
            leftLabel={`${Math.round(correctPct)}% • ${correct.toLocaleString()}`}
            rightLabel={`${Math.round(incorrectPct)}% • ${incorrect.toLocaleString()}`}
            leftClassName="bg-[#17bf8e]"
            rightClassName="bg-[#f44755]"
            leftFallbackClassName="text-[#38d5a6]"
            rightFallbackClassName="text-[#ff7680]"
            populated={hasAnswers}
          />
        </MetricBlock>

        <MetricBlock title="Completed Questions">
          <SegmentedMetricBar
            leftPct={completionPct}
            rightPct={remainingPct}
            leftLabel={`${Math.round(completionPct)}% • ${completed.toLocaleString()}`}
            rightLabel={`${Math.round(remainingPct)}% • ${remaining.toLocaleString()}`}
            leftClassName="bg-[#316ce7]"
            rightClassName="bg-[#172531]"
            leftFallbackClassName="text-[#7da7ff]"
            rightFallbackClassName="text-[#9bb1c3]"
            populated={hasQuestions}
          />
        </MetricBlock>
      </div>

      <div className="mx-5 border-t border-[#304350] sm:mx-6" />
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[12px] sm:px-6">
        <Link href={`/bank/${bankId}/question-bank`} className="inline-flex items-center gap-1 font-semibold text-[#19bbff] hover:text-[#70d4ff]">
          Practice questions <ChevronRight className="h-3.5 w-3.5" />
        </Link>
        <Link href={`/bank/${bankId}/sessions`} className="text-[#82acd0] hover:text-[#b8d6ef]">
          View previous sessions
        </Link>
      </div>
    </section>
  );
}

function EstimatedPercentileCard({
  percentile,
  adjustedScore,
  peerAverage,
}: {
  percentile: number | null;
  adjustedScore: number | null;
  peerAverage: number | null;
}) {
  const clamped = percentile == null ? null : Math.max(1, Math.min(99, percentile));
  const ordinal = clamped == null ? null : ordinalParts(clamped);

  return (
    <section className="overflow-hidden rounded-[10px] border border-[#334654] bg-[#1e2d3a] shadow-[0_3px_10px_rgba(0,0,0,0.3)]">
      <CardHeader title="Your Estimated Percentile" />

      <div className="px-5 pb-4 pt-4 sm:px-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-1 text-[12px] text-[#83acd0]">
            <span>Your estimated percentile</span>
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div className="mt-1 flex items-start justify-center text-[#19bbff]">
            {ordinal ? (
              <>
                <span className="text-[40px] font-bold leading-none tracking-[-1.5px]">{ordinal.value}</span>
                <span className="mt-[-1px] text-[22px] font-bold leading-none">{ordinal.suffix}</span>
              </>
            ) : (
              <span className="text-[40px] font-bold leading-none">—</span>
            )}
          </div>
          <p className="mt-1 text-[11px] font-semibold text-[#dbe7f0]">percentile</p>
        </div>

        <PercentileHistogram percentile={clamped} />

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#304350] pt-3 text-center">
          <div>
            <p className="text-[9px] uppercase tracking-[0.45px] text-[#7894aa]">Adjusted score</p>
            <p className="mt-1 text-[12px] font-bold text-white">{pct(adjustedScore, 1)}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-[0.45px] text-[#7894aa]">Peer benchmark</p>
            <p className="mt-1 text-[12px] font-bold text-[#c8a9ff]">{pct(peerAverage, 1)}</p>
          </div>
        </div>
      </div>

      <div className="border-t border-[#304350] px-5 py-3 text-center text-[12px] text-[#e1eaf0] sm:px-6">
        {ordinal
          ? <>Estimated higher than <strong className="text-white">{ordinal.value}%</strong> of the benchmark distribution</>
          : 'Answer benchmarked questions to estimate your percentile'}
      </div>
    </section>
  );
}

function CardHeader({ title }: { title: string }) {
  return (
    <div className="mx-5 flex items-center justify-between border-b border-[#304350] py-4 sm:mx-6">
      <h2 className="text-[12px] font-bold uppercase tracking-[0.55px] text-[#19bbff]">{title}</h2>
      <SlidersHorizontal className="h-4 w-4 text-[#7890a2]" aria-hidden="true" />
    </div>
  );
}

function MetricBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-[12px] font-semibold text-[#dbe7f0]">{title}</p>
      {children}
    </div>
  );
}

function SegmentedMetricBar({
  leftPct,
  rightPct,
  leftLabel,
  rightLabel,
  leftClassName,
  rightClassName,
  leftFallbackClassName,
  rightFallbackClassName,
  populated,
}: {
  leftPct: number;
  rightPct: number;
  leftLabel: string;
  rightLabel: string;
  leftClassName: string;
  rightClassName: string;
  leftFallbackClassName: string;
  rightFallbackClassName: string;
  populated: boolean;
}) {
  const left = populated ? clampPercent(leftPct) : 0;
  const right = populated ? clampPercent(rightPct) : 0;
  const showLeftInside = populated && left >= 14;
  const showRightInside = populated && right >= 14;

  return (
    <div>
      <div className="flex h-[36px] w-full overflow-hidden rounded-[5px] border border-[#334c60] bg-[#172531]">
        {populated ? (
          <>
            <div className={`flex h-full items-center px-3 ${leftClassName}`} style={{ width: `${left}%` }}>
              {showLeftInside ? <span className="whitespace-nowrap text-[11px] font-bold text-white">{leftLabel}</span> : null}
            </div>
            <div className={`flex h-full flex-1 items-center justify-end px-3 ${rightClassName}`} style={{ width: `${right}%` }}>
              {showRightInside ? <span className="whitespace-nowrap text-[11px] font-bold text-white">{rightLabel}</span> : null}
            </div>
          </>
        ) : null}
      </div>

      {(!showLeftInside || !showRightInside) ? (
        <div className="mt-2 flex min-h-[15px] items-center justify-between gap-3 text-[10px] font-semibold">
          <span className={showLeftInside ? 'invisible' : leftFallbackClassName}>{leftLabel}</span>
          <span className={`${showRightInside ? 'invisible' : rightFallbackClassName} text-right`}>{rightLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

const DISTRIBUTION_BARS = Array.from({ length: 41 }, (_, index) => {
  const position = (index / 40) * 100;
  const z = (position - 50) / 18;
  return {
    position,
    height: Math.max(4, Math.exp(-0.5 * z * z) * 100),
  };
});

function distributionBarClass(position: number) {
  if (position < 25) return 'bg-[#ee4054]';
  if (position < 40) return 'bg-[#f05c35]';
  if (position < 52) return 'bg-[#ff7a00]';
  if (position < 64) return 'bg-[#f4c400]';
  if (position < 75) return 'bg-[#79bd13]';
  if (position < 88) return 'bg-[#22ad62]';
  return 'bg-[#12b990]';
}

function PercentileHistogram({ percentile }: { percentile: number | null }) {
  return (
    <div className="mt-4" aria-label="Estimated percentile benchmark distribution">
      <div className="relative h-[116px] border-b border-[#385165]">
        <div className="absolute inset-x-1 bottom-0 flex h-[103px] items-end gap-[2px]">
          {DISTRIBUTION_BARS.map((bar) => (
            <span
              key={bar.position}
              className={`min-w-0 flex-1 ${distributionBarClass(bar.position)}`}
              style={{ height: `${bar.height}%` }}
            />
          ))}
        </div>

        {percentile != null ? (
          <div
            className="absolute bottom-0 top-0 z-10 w-px -translate-x-1/2 bg-white"
            style={{ left: `${percentile}%` }}
          >
            <span className="absolute -left-[5px] top-0 h-[11px] w-[11px] rounded-full border-2 border-[#142432] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.2)]" />
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex justify-between text-[9px] text-[#7390a7]">
        {[0, 20, 40, 60, 80, 100].map((value) => <span key={value}>{value}%</span>)}
      </div>
    </div>
  );
}

function CategoryPerformance({ performance }: { performance: BankPerformanceSummary }) {
  return (
    <details className="group overflow-hidden rounded-[8px] border border-[#334654] bg-[#1e2d3a] shadow-[0_2px_7px_rgba(0,0,0,0.24)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-[14px] text-[12px] font-semibold text-white marker:content-none sm:px-6">
        <span>
          Performance by Category
          <span className="ml-2 text-[10px] font-normal text-[#7894aa]">Click to expand</span>
        </span>
        <ChevronDown className="h-4 w-4 text-[#8fa5b5] transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-[#304350] px-5 pb-5 pt-4 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <p className="text-[10px] text-[#7894aa]">Difficulty-adjusted score compared with the empirical correct-answer percentage for the same questions.</p>
          <div className="flex gap-4 text-[10px] text-[#9fb0bc]">
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#59bd78]" />Your score</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#9475d8]" />Peer average</span>
          </div>
        </div>

        {performance.categories.length === 0 ? (
          <div className="rounded-[4px] border border-[#3b4e5d] bg-[#182632] px-4 py-8 text-center text-[12px] text-[#9fb0bc]">Answer questions to build your live category performance.</div>
        ) : (
          <div className="space-y-3">
            {performance.categories.map((row) => {
              const yours = row.user_score ?? row.accuracy;
              const peers = row.peer_average;
              const yoursWidth = yours == null ? 0 : clampPercent(yours);
              const peerWidth = peers == null ? 0 : clampPercent(peers);
              return (
                <div key={row.category} className="grid gap-2 md:grid-cols-[185px_1fr_124px] md:items-center">
                  <div className="truncate text-[11px] font-medium text-[#e3ebf0]" title={row.category}>{row.category}</div>
                  <div className="space-y-[3px]">
                    <div className="h-[7px] overflow-hidden rounded-full bg-[#172531]"><div className="h-full bg-[#59bd78]" style={{ width: `${yoursWidth}%` }} /></div>
                    <div className="h-[5px] overflow-hidden rounded-full bg-[#172531]"><div className="h-full bg-[#9475d8]" style={{ width: `${peerWidth}%` }} /></div>
                  </div>
                  <div className="flex justify-between text-[10px] text-[#91a4b2]"><span>{pct(yours, 0)} / {pct(peers, 0)}</span><span>P{row.estimated_percentile == null ? '—' : Math.round(row.estimated_percentile)}</span></div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

function StatPill({ value, tone, icon }: { value: string; tone: 'amber' | 'green'; icon: React.ReactNode }) {
  const className = tone === 'amber' ? 'bg-[#fff5c9] text-[#8a5c00]' : 'bg-[#dff5df] text-[#1b6128]';
  return <div className={`flex min-w-[116px] items-center justify-center gap-2 rounded-[5px] px-3 py-[4px] text-[10px] font-bold ${className}`}>{icon}<span>{value}</span></div>;
}

function ActivityHeatmap({ title, days, mode }: { title: string; days: BankActivityDay[]; mode: 'volume' | 'accuracy' }) {
  const byDate = new Map(days.map((day) => [day.date.slice(0, 10), day]));
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(end.getDate() - 97);
  const cells = Array.from({ length: 98 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { key, data: byDate.get(key) };
  });
  const maxAnswered = Math.max(1, ...days.map((day) => day.answered));

  const cellClass = (day: BankActivityDay | undefined) => {
    if (!day || day.answered <= 0) return 'bg-[#f2f5f7]';
    if (mode === 'accuracy') {
      const accuracy = day.accuracy ?? 0;
      if (accuracy >= 80) return 'bg-[#52cc76]';
      if (accuracy >= 65) return 'bg-[#8ee19d]';
      if (accuracy >= 50) return 'bg-[#ffd59e]';
      return 'bg-[#ff9b8e]';
    }
    const ratio = day.answered / maxAnswered;
    if (ratio > 0.75) return 'bg-[#4ecb72]';
    if (ratio > 0.45) return 'bg-[#83dc91]';
    if (ratio > 0.2) return 'bg-[#b9e9bf]';
    return 'bg-[#dff5df]';
  };

  return (
    <div>
      <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[#bdc7cd]">{title}</p>
      <div className="flex items-start justify-center gap-[6px]">
        <div className="space-y-[2px] pt-[1px] text-right text-[10px] leading-[12px] text-white">{['M','T','W','T','F','S','S'].map((day, index) => <div key={`${day}-${index}`} className="h-[12px]">{day}</div>)}</div>
        <div className="grid grid-flow-col grid-rows-7 gap-[2px]">
          {cells.map(({ key, data }) => <span key={key} title={`${key}: ${data?.answered || 0} answered${mode === 'accuracy' && data?.accuracy != null ? `, ${data.accuracy.toFixed(1)}% accuracy` : ''}`} className={`h-[12px] w-[12px] rounded-[1px] border border-[#dce3e8] ${cellClass(data)}`} />)}
        </div>
      </div>
    </div>
  );
}
