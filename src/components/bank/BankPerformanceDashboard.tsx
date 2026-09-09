import Link from 'next/link';
import { BarChart3, ChevronDown, Flame, Target } from 'lucide-react';
import type {
  BankActivityDay,
  BankPerformanceDifficulty,
  BankPerformanceSummary,
} from '@/lib/bank-performance';

function pct(value: number | null, digits = 0) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`;
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

export function BankPerformanceDashboard({ performance }: { performance: BankPerformanceSummary }) {
  const answered = performance.answered;
  const correctPct = answered > 0 ? (performance.correct / answered) * 100 : 0;
  const incorrectPct = answered > 0 ? (performance.incorrect / answered) * 100 : 0;

  return (
    <section className="rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
      <div className="border-b border-[#2a3035] px-[14px] py-[11px]">
        <h2 className="text-[13px] font-semibold text-white">Question Bank Overview</h2>
        <p className="mt-1 text-[11px] text-[#9eabb4]">Everything below is calculated from your persisted answers, empirical option percentages and question difficulty.</p>
      </div>

      <div className="grid gap-3 p-[14px] lg:grid-cols-3">
        <OverviewPanel title="Correct vs Incorrect">
          <div className="mt-4 h-[7px] overflow-hidden rounded-full bg-[#252b30]">
            <div className="flex h-full w-full">
              <span className="h-full bg-[#38b871]" style={{ width: `${correctPct}%` }} />
              <span className="h-full bg-[#ef5c5c]" style={{ width: `${incorrectPct}%` }} />
            </div>
          </div>
          <div className="mt-4 flex justify-between text-[12px]">
            <div><span className="font-bold text-[#59d18c]">{performance.correct}</span><span className="ml-1 text-[#a9b3ba]">correct ({correctPct.toFixed(0)}%)</span></div>
            <div><span className="font-bold text-[#ff7777]">{performance.incorrect}</span><span className="ml-1 text-[#a9b3ba]">incorrect ({incorrectPct.toFixed(0)}%)</span></div>
          </div>
        </OverviewPanel>

        <OverviewPanel title="Completed Questions">
          <div className="mt-4 text-center">
            <p className="text-[28px] font-bold text-white">{performance.answered.toLocaleString()}</p>
            <p className="text-[11px] text-[#9eabb4]">of {performance.total_questions.toLocaleString()} questions</p>
          </div>
          <div className="mt-4 h-[7px] overflow-hidden rounded-full bg-[#252b30]">
            <div className="h-full bg-[#6f8bd7]" style={{ width: `${Math.min(100, performance.completion_percentage)}%` }} />
          </div>
          <p className="mt-3 text-center text-[11px] font-semibold text-[#c7d2ff]">{pct(performance.completion_percentage, 1)} complete</p>
        </OverviewPanel>

        <OverviewPanel title="Estimated Percentile">
          <PercentileCurve percentile={performance.estimated_percentile} />
          <div className="mt-1 grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-[10px] uppercase text-[#8e9aa3]">Your adjusted score</p>
              <p className="mt-1 font-bold text-white">{pct(performance.difficulty_adjusted_score, 1)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-[#8e9aa3]">Peer benchmark</p>
              <p className="mt-1 font-bold text-[#cdb2ff]">{pct(performance.peer_average, 1)}</p>
            </div>
          </div>
        </OverviewPanel>
      </div>

      <details className="group border-t border-[#2a3035]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-[14px] py-[12px] text-[12px] font-semibold text-white marker:content-none">
          <span>
            Performance by Category
            <span className="ml-2 text-[10px] font-normal text-[#8f9ba4]">Click to show category progress</span>
          </span>
          <ChevronDown className="h-4 w-4 text-[#9ea9b1] transition-transform group-open:rotate-180" />
        </summary>

        <div className="border-t border-[#2a3035] px-[14px] pb-[14px] pt-[12px]">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <p className="text-[10px] text-[#8f9ba4]">Difficulty-adjusted score compared with the empirical correct-answer percentage for the same questions.</p>
            <div className="flex gap-4 text-[10px] text-[#a9b3ba]"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#59bd78]" />Your score</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#9475d8]" />Peer average</span></div>
          </div>

          {performance.categories.length === 0 ? (
            <div className="rounded-[4px] border border-[#495159] bg-[#2e3439] px-4 py-8 text-center text-[12px] text-[#a9b3ba]">Answer questions to build your live category performance.</div>
          ) : (
            <div className="space-y-3">
              {performance.categories.map((row) => {
                const yours = row.user_score ?? row.accuracy;
                const peers = row.peer_average;
                const yoursWidth = yours == null ? 0 : Math.max(0, Math.min(100, yours));
                const peerWidth = peers == null ? 0 : Math.max(0, Math.min(100, peers));
                return (
                  <div key={row.category} className="grid gap-2 md:grid-cols-[185px_1fr_124px] md:items-center">
                    <div className="truncate text-[11px] font-medium text-[#dce3e8]" title={row.category}>{row.category}</div>
                    <div className="space-y-[3px]">
                      <div className="h-[7px] overflow-hidden rounded-full bg-[#252b30]"><div className="h-full bg-[#59bd78]" style={{ width: `${yoursWidth}%` }} /></div>
                      <div className="h-[5px] overflow-hidden rounded-full bg-[#252b30]"><div className="h-full bg-[#9475d8]" style={{ width: `${peerWidth}%` }} /></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-[#9ea9b1]"><span>{pct(yours, 0)} / {pct(peers, 0)}</span><span>P{row.estimated_percentile == null ? '—' : Math.round(row.estimated_percentile)}</span></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

function OverviewPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="rounded-[4px] border border-[#495159] bg-[#2e3439] p-4"><h3 className="text-[11px] font-semibold uppercase tracking-[0.2px] text-[#b0bbc3]">{title}</h3>{children}</article>;
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

function PercentileCurve({ percentile }: { percentile: number | null }) {
  const value = percentile == null ? 50 : Math.max(1, Math.min(99, percentile));
  const x = 18 + (value / 100) * 164;
  const y = 68 - 50 * Math.exp(-Math.pow((value - 50) / 24, 2));
  return (
    <div className="mt-2">
      <svg viewBox="0 0 200 82" className="h-[78px] w-full" aria-label="Estimated percentile curve">
        <path d="M10 70 C35 70 39 22 72 20 C100 8 125 16 139 36 C153 56 166 69 190 70" fill="none" stroke="#72818d" strokeWidth="2" />
        <line x1="10" y1="70" x2="190" y2="70" stroke="#4f5a63" strokeWidth="1" />
        {percentile != null ? <><line x1={x} y1={70} x2={x} y2={y} stroke="#cfa7ff" strokeDasharray="3 2" /><circle cx={x} cy={y} r="4" fill="#cfa7ff" /></> : null}
      </svg>
      <p className="-mt-2 text-center text-[22px] font-bold text-white">{percentile == null ? '—' : `${Math.round(percentile)}th`}</p>
      <p className="text-center text-[10px] text-[#8f9ba4]">Estimated percentile</p>
    </div>
  );
}
