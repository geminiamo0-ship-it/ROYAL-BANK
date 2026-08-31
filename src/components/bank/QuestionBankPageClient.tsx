'use client';

import React, { useMemo, useState, useTransition, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startExamSession } from '@/actions/exam';
import { encodeTopicFilter } from '@/lib/topic-filters';
import type { CategoryWithTopics, TopicSummary } from '@/types/question-bank';
import { ChevronRight, Minus, Plus, Search, Hammer } from 'lucide-react';
import type { QuestionSelection } from '@/types/database';

const RECENT_SESSIONS = [
  { id: 'all-1', label: 'Standard', title: 'All categories', age: '1 day ago', tag: '' },
  { id: 'cardiology-1', label: 'Standard', title: 'Cardiology', age: '1 day ago', tag: '' },
  { id: 'all-2', label: 'Standard', title: 'All categories', age: '5 days ago', tag: '' },
  { id: 'incorrect-1', label: 'Standard', title: 'All categories', age: '6 days ago', tag: 'Previously incorrect' },
  { id: 'all-3', label: 'Standard', title: 'All categories', age: '6 days ago', tag: '' },
];

const QUESTION_SELECTION_OPTIONS: Array<{ value: QuestionSelection; label: string }> = [
  { value: 'new_only', label: 'Show me new questions only' },
  { value: 'all', label: 'Show me all available questions' },
  { value: 'incorrect_only', label: 'Only previously incorrect questions' },
  { value: 'flagged_only', label: 'Only flagged questions' },
  { value: 'suspended_only', label: 'Suspended / incomplete questions' },
];

const QUESTION_ORDER_OPTIONS = [
  { value: 'balanced', label: 'Balanced order' },
  { value: 'sequential', label: 'Sequential order' },
  { value: 'adaptive', label: 'Adaptive focus' },
];

function getCountForSelection(
  item: Pick<CategoryWithTopics, 'totalByDiff' | 'attemptedByDiff' | 'incorrectByDiff' | 'flaggedByDiff' | 'suspendedByDiff'>,
  selection: QuestionSelection,
  difficulties: string[]
) {
  const sum = (counts: Record<string, number>) => difficulties.reduce((acc, d) => acc + (counts[d] || 0), 0);

  switch (selection) {
    case 'new_only':
      return Math.max(sum(item.totalByDiff) - sum(item.attemptedByDiff), 0);
    case 'incorrect_only':
      return sum(item.incorrectByDiff);
    case 'flagged_only':
      return sum(item.flaggedByDiff);
    case 'suspended_only':
      return sum(item.suspendedByDiff);
    case 'all':
    default:
      return sum(item.totalByDiff);
  }
}

function getSelectionLabel(selection: QuestionSelection) {
  switch (selection) {
    case 'new_only':
      return 'new';
    case 'incorrect_only':
      return 'incorrect';
    case 'flagged_only':
      return 'flagged';
    case 'suspended_only':
      return 'suspended';
    case 'all':
    default:
      return 'questions';
  }
}

function topicSelectionKey(categoryId: string, topicId: string) {
  return `${categoryId}|||${topicId}`;
}

export function QuestionBankPageClient({
  bankId,
  initialCategories,
}: {
  bankId: number;
  initialCategories: CategoryWithTopics[];
}) {
  const router = useRouter();
  const categories = initialCategories;
  const initialCategoryIds = useMemo(
    () => categories.map((category) => category.id),
    [categories]
  );

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(initialCategoryIds);
  const [selectedTopicKeys, setSelectedTopicKeys] = useState<string[]>([]);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>(['1', '2', '3']);
  const [questionSelection, setQuestionSelection] = useState<QuestionSelection>('new_only');
  const [sessionMode, setSessionMode] = useState<'standard' | 'fixed_timed'>('standard');
  const [questionCount, setQuestionCount] = useState<number>(40);
  const [questionOrderMode, setQuestionOrderMode] = useState('balanced');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredCategories = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return categories;

    return categories.flatMap((category) => {
      const categoryMatches =
        category.name.toLowerCase().includes(normalizedSearch) ||
        category.id.toLowerCase().includes(normalizedSearch);

      const matchingTopics = category.topics.filter((topic) =>
        topic.name.toLowerCase().includes(normalizedSearch)
      );

      if (categoryMatches) {
        return [category];
      }

      if (matchingTopics.length > 0) {
        return [
          {
            ...category,
            topics: matchingTopics,
          },
        ];
      }

      return [];
    });
  }, [categories, search]);

  const totalAttempted = useMemo(
    () => categories.reduce((sum, category) => sum + category.attempted, 0),
    [categories]
  );

  const selectedQuestions = useMemo(
    () =>
      categories.reduce((sum, category) => {
        if (selectedCategoryIds.includes(category.id)) {
          return sum + getCountForSelection(category, questionSelection, selectedDifficulties);
        }

        return (
          sum +
          category.topics.reduce((topicSum, topic) => {
            const key = topicSelectionKey(category.id, topic.id);
            return topicSum + (selectedTopicKeys.includes(key) ? getCountForSelection(topic, questionSelection, selectedDifficulties) : 0);
          }, 0)
        );
      }, 0),
    [categories, questionSelection, selectedCategoryIds, selectedTopicKeys, selectedDifficulties]
  );

  const selectedAttempted = useMemo(
    () =>
      categories.reduce(
        (sum, category) => {
          if (selectedCategoryIds.includes(category.id)) {
            return sum + selectedDifficulties.reduce((a, d) => a + (category.attemptedByDiff[d] || 0), 0);
          }
          return sum + category.topics.reduce((tSum, topic) => {
            const key = topicSelectionKey(category.id, topic.id);
            return tSum + (selectedTopicKeys.includes(key) ? selectedDifficulties.reduce((a, d) => a + (topic.attemptedByDiff[d] || 0), 0) : 0);
          }, 0);
        },
        0
      ),
    [categories, selectedCategoryIds, selectedTopicKeys, selectedDifficulties]
  );

  const selectedTopicFilters = useMemo(
    () =>
      categories.flatMap((category) =>
        category.topics
          .filter((topic) => selectedTopicKeys.includes(topicSelectionKey(category.id, topic.id)))
          .map((topic) => encodeTopicFilter(category.id, topic.name))
      ),
    [categories, selectedTopicKeys]
  );

  const allSelected =
    categories.length > 0 &&
    selectedCategoryIds.length === categories.length &&
    selectedTopicKeys.length === 0;

  const averageScore =
    totalAttempted > 0 ? Math.round((selectedAttempted / totalAttempted) * 100) : 0;

  const selectionLabel = getSelectionLabel(questionSelection);

  const summaryMeta =
    questionSelection === 'all'
      ? `Attempted ${selectedAttempted} of ${selectedQuestions.toLocaleString()}`
      : `${selectedQuestions.toLocaleString()} ${selectionLabel}`;

  const launchQuestions = (categoryIds: string[], topicFilters: string[]) => {
    const nextTopicFilters = [...topicFilters];
    const nextCategoryIds =
      nextTopicFilters.length === 0 && categoryIds.length === categories.length
        ? []
        : [...categoryIds];

    setError(null);

    startTransition(async () => {
      try {
        const sessionId = await startExamSession({
          bankId,
          categories: nextCategoryIds,
          topicFilters: nextTopicFilters,
          difficulties: selectedDifficulties,
          questionSelection,
          sessionType: sessionMode,
          limit: questionCount,
        });
        router.push(`/exam/${sessionId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to start the questions.');
      }
    });
  };

  useEffect(() => {
    if (questionCount > selectedQuestions && selectedQuestions > 0) {
      setQuestionCount(Math.min(70, selectedQuestions));
    }
  }, [selectedQuestions, questionCount]);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds((current) => {
      const next = current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId];

      if (!current.includes(categoryId)) {
        setSelectedTopicKeys((topicKeys) =>
          topicKeys.filter((key) => !key.startsWith(`${categoryId}|||`))
        );
      }

      return next;
    });
  };

  const toggleAllCategories = () => {
    if (allSelected) {
      setSelectedCategoryIds([]);
      setSelectedTopicKeys([]);
      return;
    }

    setSelectedCategoryIds(categories.map((category) => category.id));
    setSelectedTopicKeys([]);
  };

  const toggleDifficulty = (difficulty: string) => {
    setSelectedDifficulties((current) =>
      current.includes(difficulty)
        ? current.filter((item) => item !== difficulty)
        : [...current, difficulty]
    );
  };

  const toggleExpandCategory = (categoryId: string) => {
    setExpandedCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId]
    );
  };

  const toggleTopic = (categoryId: string, topic: TopicSummary) => {
    const key = topicSelectionKey(categoryId, topic.id);
    setSelectedCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : current
    );
    setSelectedTopicKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  return (
    <div className="mx-auto max-w-[1088px] space-y-[12px] text-[12px] text-white">
      <section className="relative overflow-hidden rounded-[4px] bg-[#394046] px-[12px] py-[12px] shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
        <div
          className="absolute right-[-60px] top-0 h-full w-[410px] bg-[#2e6a55]/55"
          style={{ clipPath: 'polygon(35% 0, 100% 0, 100% 40%, 25% 100%, 0 100%, 18% 35%)' }}
        />
        <div
          className="absolute right-[88px] top-0 h-full w-[190px] bg-[#2b5b50]/70"
          style={{ clipPath: 'polygon(48% 0, 100% 100%, 0 100%)' }}
        />

        <div className="relative">
          <h1 className="text-[20px] font-semibold tracking-[-0.35px] text-[#f4f4f4]">Question bank</h1>
          <p className="mt-5 text-[12px] text-[#edf1f4]">Welcome to the main question bank.</p>
          <p className="mt-8 text-[12px] text-[#edf1f4]">
            You&apos;ve answered {totalAttempted} questions with an average score of {averageScore}%.
            {' '}
            <Link href={`/bank/${bankId}/performance`} className="font-semibold text-[#cda9ff] hover:underline">
              More
            </Link>
          </p>
        </div>
      </section>

      {error && (
        <div className="rounded-[4px] border border-[#95413d] bg-[#3a2d2c] px-3 py-2 text-[12px] text-[#ffd4ce]">
          {error}
        </div>
      )}

      <section className="rounded-[4px] bg-[#353c42] px-[12px] py-[10px] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="inline-flex h-[28px] items-center rounded-[2px] bg-[#f3f4f6] px-3 text-[12px] text-[#363636]">
              {selectedQuestions.toLocaleString()} {selectionLabel} found
            </div>
            <label className="relative block w-full sm:w-[270px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8e9ba4]" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search category or topic..."
                className="h-[30px] w-full rounded-[2px] border border-[#4a545d] bg-[#2c3237] pl-9 pr-3 text-[12px] text-white outline-none placeholder:text-[#8e9ba4] focus:border-[#7da7ff]"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => launchQuestions(selectedCategoryIds, selectedTopicFilters)}
            disabled={isPending}
            className="inline-flex h-[30px] items-center justify-center gap-2 rounded-[4px] bg-[#d5e4ff] px-4 text-[12px] font-medium text-[#1d3152] hover:bg-[#e3ebff] disabled:opacity-60"
          >
            <span>{isPending ? 'Starting...' : 'Start the questions'}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      <div className="grid gap-[12px] lg:grid-cols-[1.38fr_1fr]">
        <section className="rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
          <PanelHeader title="Categories" />
          <div className="px-[12px] pb-[12px]">
            <CategoryRow
              checked={allSelected}
              title="All"
              meta={summaryMeta}
              onToggle={toggleAllCategories}
              strong
            />

            <div className="mt-[2px] space-y-[1px]">
              {filteredCategories.map((category) => {
                const isExpanded =
                  expandedCategoryIds.includes(category.id) ||
                  (search.trim().length > 0 && category.topics.length > 0);

                return (
                  <div key={category.id}>
                    <CategoryRow
                      checked={selectedCategoryIds.includes(category.id)}
                      title={category.name}
                      meta={
                        questionSelection === 'all'
                          ? `${selectedDifficulties.reduce((a, d) => a + (category.attemptedByDiff[d] || 0), 0)} of ${getCountForSelection(category, 'all', selectedDifficulties).toLocaleString()}`
                          : `${getCountForSelection(category, questionSelection, selectedDifficulties).toLocaleString()} ${selectionLabel}`
                      }
                      onToggle={() => toggleCategory(category.id)}
                      canExpand={category.topics.length > 0}
                      expanded={isExpanded}
                      onToggleExpand={() => toggleExpandCategory(category.id)}
                    />

                    {isExpanded && category.topics.length > 0 ? (
                      <div className="border-x border-b border-[#78828a] bg-[#31363b] px-3 py-2">
                        <div className="space-y-[6px]">
                          {category.topics.map((topic) => {
                            const key = topicSelectionKey(category.id, topic.id);
                            return (
                              <label
                                key={key}
                                className="flex cursor-pointer items-center gap-3 pl-6 text-[12px] text-[#e7ebef]"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedTopicKeys.includes(key)}
                                  onChange={() => toggleTopic(category.id, topic)}
                                  className="h-[12px] w-[12px] rounded-[2px] accent-[#3e73ff]"
                                />
                                <span className="min-w-0 flex-1 truncate">{topic.name}</span>
                                <span className="rounded-full border border-[#d9a8a8] px-2 py-[1px] text-[10px] font-semibold text-[#ffd7d7]">
                                  {getCountForSelection(topic, questionSelection, selectedDifficulties)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <div className="space-y-[12px]">
          <section className="rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
            <PanelHeader title="Question mode" />
            <div className="p-3">
              <div className="mb-4 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSessionMode('standard')}
                  className={`flex flex-col items-start justify-center rounded-[4px] border p-3 text-left transition-colors ${
                    sessionMode === 'standard'
                      ? 'border-[#3e73ff] bg-[#2c3d5e] text-[#f4f4f4]'
                      : 'border-[#4a545d] bg-[#2c3237] text-[#c6cdd3] hover:border-[#80868b]'
                  }`}
                >
                  <span className="font-semibold">Tutor</span>
                  <span className="mt-1 text-[11px] opacity-70">Answer shown after each question</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSessionMode('fixed_timed')}
                  className={`flex flex-col items-start justify-center rounded-[4px] border p-3 text-left transition-colors ${
                    sessionMode === 'fixed_timed'
                      ? 'border-[#3e73ff] bg-[#2c3d5e] text-[#f4f4f4]'
                      : 'border-[#4a545d] bg-[#2c3237] text-[#c6cdd3] hover:border-[#80868b]'
                  }`}
                >
                  <span className="font-semibold">Timed</span>
                  <span className="mt-1 text-[11px] opacity-70">Custom time per question</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[12px] text-[#c6cdd3]">No. of questions</span>
                <div className="flex items-center rounded-[4px] border border-[#4a545d] bg-[#22272b]">
                  <button
                    type="button"
                    onClick={() => setQuestionCount(Math.max(1, questionCount - 1))}
                    className="flex h-7 w-7 items-center justify-center text-[#c6cdd3] hover:text-white"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={Math.min(70, Math.max(1, selectedQuestions))}
                    value={questionCount}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val)) {
                        setQuestionCount(Math.min(Math.min(70, Math.max(1, selectedQuestions)), Math.max(1, val)));
                      }
                    }}
                    className="w-12 bg-transparent text-center text-[13px] font-semibold text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setQuestionCount(Math.min(Math.min(70, Math.max(1, selectedQuestions)), questionCount + 1))}
                    className="flex h-7 w-7 items-center justify-center text-[#c6cdd3] hover:text-white"
                  >
                    +
                  </button>
                </div>
                <span className="text-[11px] text-[#8e9ba4]">of {selectedQuestions.toLocaleString()}</span>
              </div>
            </div>
          </section>

          <section className="rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
            <PanelHeader title="Difficulty" />
            <div className="flex flex-wrap gap-8 px-[12px] py-[14px]">
              {[
                { value: '1', hammers: 1 },
                { value: '2', hammers: 2 },
                { value: '3', hammers: 3 },
              ].map((difficulty) => (
                <label key={difficulty.value} className="inline-flex items-center gap-2 text-[13px] text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDifficulties.includes(difficulty.value)}
                    onChange={() => toggleDifficulty(difficulty.value)}
                    className="h-[14px] w-[14px] rounded-[2px] accent-[#3e73ff] cursor-pointer"
                  />
                  <span className="flex items-center gap-[2px]">
                    {Array.from({ length: difficulty.hammers }).map((_, i) => (
                      <Hammer key={i} size={15} className={selectedDifficulties.includes(difficulty.value) ? 'text-[#ff9500]' : 'text-[#5a646c]'} strokeWidth={2.5} />
                    ))}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
            <PanelHeader title="Question selection" />
            <div className="space-y-[8px] px-[12px] py-[12px]">
              <div className="rounded-[3px] border border-[#46505a] bg-[#2f353a] px-3 py-2 text-[11px] text-[#dfe7ee]">
                Current filter: <span className="font-semibold text-white">{selectedQuestions.toLocaleString()} {selectionLabel}</span>
              </div>
              {QUESTION_SELECTION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setQuestionSelection(option.value)}
                  className={`flex h-[28px] w-full items-center rounded-[3px] border px-3 text-left text-[12px] transition-colors ${
                    questionSelection === option.value
                      ? 'border-[#b9cbf7] bg-[#2c3d5e] text-white'
                      : 'border-[#80868b] bg-[#34393e] text-[#edf1f4] hover:border-[#aeb8c2]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function PanelHeader({ title }: { title: string }) {
  return (
    <div className="px-[12px] py-[9px] text-[11px] uppercase tracking-[0.25px] text-[#4f565b]">
      {title}
    </div>
  );
}

function CategoryRow({
  checked,
  title,
  meta,
  onToggle,
  strong = false,
  canExpand = false,
  expanded = false,
  onToggleExpand,
}: {
  checked: boolean;
  title: string;
  meta: string;
  onToggle: () => void;
  strong?: boolean;
  canExpand?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border border-[#9ca3aa] px-[8px] py-[4px] hover:bg-[#3a4147]">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-[12px] w-[12px] rounded-[2px] accent-[#3e73ff]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <span className={`${strong ? 'font-semibold' : 'font-normal'} text-[12px] text-white`}>
              {title}
            </span>
            <span className="text-[11px] font-semibold text-white">{meta}</span>
          </div>
        </div>
      </label>

      {canExpand && onToggleExpand ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[3px] border border-[#d7b3b3] text-[#f6d8d8] hover:bg-[#434a51]"
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
        >
          {expanded ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      ) : null}
    </div>
  );
}




