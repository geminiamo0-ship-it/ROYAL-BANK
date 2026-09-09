'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Search } from 'lucide-react';
import { QuestionBankCategoriesPanel } from '@/components/bank/QuestionBankCategoriesPanel';
import { QuestionBankControls } from '@/components/bank/QuestionBankControls';
import { startExamSession } from '@/lib/exam-launch';
import {
  getCountForSelection,
  getSelectionLabel,
  topicSelectionKey,
} from '@/lib/question-bank-selection';
import { encodeTopicFilter } from '@/lib/topic-filters';
import type { QuestionSelection, SessionType } from '@/types/database';
import type { CategoryWithTopics, TopicSummary } from '@/types/question-bank';

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
    [categories],
  );

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(initialCategoryIds);
  const [selectedTopicKeys, setSelectedTopicKeys] = useState<string[]>([]);
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>(['1', '2', '3']);
  const [questionSelection, setQuestionSelection] = useState<QuestionSelection>('new_only');
  const [sessionMode, setSessionMode] = useState<Extract<SessionType, 'tutor' | 'timed'>>('tutor');
  const [questionCount, setQuestionCount] = useState(40);
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
        topic.name.toLowerCase().includes(normalizedSearch),
      );

      if (categoryMatches) return [category];
      if (matchingTopics.length > 0) return [{ ...category, topics: matchingTopics }];
      return [];
    });
  }, [categories, search]);

  const totalAttempted = useMemo(
    () => categories.reduce((sum, category) => sum + category.attempted, 0),
    [categories],
  );

  const totalIncorrect = useMemo(
    () => categories.reduce((sum, category) => sum + category.incorrectCount, 0),
    [categories],
  );

  const selectedQuestions = useMemo(
    () =>
      categories.reduce((sum, category) => {
        if (selectedCategoryIds.includes(category.id)) {
          return sum + getCountForSelection(category, questionSelection, selectedDifficulties);
        }

        return sum + category.topics.reduce((topicSum, topic) => {
          const key = topicSelectionKey(category.id, topic.id);
          return topicSum +
            (selectedTopicKeys.includes(key)
              ? getCountForSelection(topic, questionSelection, selectedDifficulties)
              : 0);
        }, 0);
      }, 0),
    [categories, questionSelection, selectedCategoryIds, selectedTopicKeys, selectedDifficulties],
  );

  const selectedAttempted = useMemo(
    () =>
      categories.reduce((sum, category) => {
        if (selectedCategoryIds.includes(category.id)) {
          return (
            sum +
            selectedDifficulties.reduce(
              (attemptedSum, difficulty) =>
                attemptedSum + (category.attemptedByDiff[difficulty] || 0),
              0,
            )
          );
        }

        return sum + category.topics.reduce((topicSum, topic) => {
          const key = topicSelectionKey(category.id, topic.id);
          if (!selectedTopicKeys.includes(key)) return topicSum;

          return (
            topicSum +
            selectedDifficulties.reduce(
              (attemptedSum, difficulty) =>
                attemptedSum + (topic.attemptedByDiff[difficulty] || 0),
              0,
            )
          );
        }, 0);
      }, 0),
    [categories, selectedCategoryIds, selectedTopicKeys, selectedDifficulties],
  );

  const selectedTopicFilters = useMemo(
    () =>
      categories.flatMap((category) =>
        category.topics
          .filter((topic) => selectedTopicKeys.includes(topicSelectionKey(category.id, topic.id)))
          .map((topic) => encodeTopicFilter(category.id, topic.name)),
      ),
    [categories, selectedTopicKeys],
  );

  const allSelected =
    categories.length > 0 &&
    selectedCategoryIds.length === categories.length &&
    selectedTopicKeys.length === 0;

  const averageScore =
    totalAttempted > 0
      ? Math.round(((totalAttempted - totalIncorrect) / totalAttempted) * 100)
      : 0;
  const selectionLabel = getSelectionLabel(questionSelection);
  const boundedQuestionCount =
    selectedQuestions > 0 ? Math.min(70, selectedQuestions, questionCount) : 1;
  const summaryMeta =
    questionSelection === 'all'
      ? `Attempted ${selectedAttempted} of ${selectedQuestions.toLocaleString()}`
      : `${selectedQuestions.toLocaleString()} ${selectionLabel}`;

  const launchQuestions = () => {
    if (selectedDifficulties.length === 0) {
      setError('Select at least one difficulty.');
      return;
    }
    if (selectedQuestions <= 0) {
      setError('No questions match the selected filters.');
      return;
    }

    const topicFilters = [...selectedTopicFilters];
    const categoryIds =
      topicFilters.length === 0 && selectedCategoryIds.length === categories.length
        ? []
        : [...selectedCategoryIds];

    setError(null);
    startTransition(async () => {
      try {
        const sessionId = await startExamSession({
          bankId,
          categories: categoryIds,
          topicFilters,
          difficulties: selectedDifficulties,
          questionSelection,
          sessionType: sessionMode,
          limit: boundedQuestionCount,
        });
        router.push(`/exam/${sessionId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to start the questions.');
      }
    });
  };

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds((current) => {
      const selecting = !current.includes(categoryId);
      const next = selecting
        ? [...current, categoryId]
        : current.filter((id) => id !== categoryId);

      if (selecting) {
        setSelectedTopicKeys((topicKeys) =>
          topicKeys.filter((key) => !key.startsWith(`${categoryId}|||`)),
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
        : [...current, difficulty],
    );
  };

  const toggleExpandCategory = (categoryId: string) => {
    setExpandedCategoryIds((current) =>
      current.includes(categoryId)
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId],
    );
  };

  const toggleTopic = (categoryId: string, topic: TopicSummary) => {
    const key = topicSelectionKey(categoryId, topic.id);
    setSelectedCategoryIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : current,
    );
    setSelectedTopicKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
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
            You&apos;ve answered {totalAttempted} questions with an average score of {averageScore}%.{' '}
            <Link href={`/bank/${bankId}/performance`} className="font-semibold text-[#cda9ff] hover:underline">
              More
            </Link>
          </p>
        </div>
      </section>

      {error ? (
        <div className="rounded-[4px] border border-[#95413d] bg-[#3a2d2c] px-3 py-2 text-[12px] text-[#ffd4ce]">
          {error}
        </div>
      ) : null}

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
            onClick={launchQuestions}
            disabled={isPending || selectedQuestions <= 0 || selectedDifficulties.length === 0}
            className="inline-flex h-[30px] items-center justify-center gap-2 rounded-[4px] bg-[#d5e4ff] px-4 text-[12px] font-medium text-[#1d3152] hover:bg-[#e3ebff] disabled:opacity-60"
          >
            <span>{isPending ? 'Starting...' : 'Start the questions'}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      <div className="grid gap-[12px] lg:grid-cols-[1.38fr_1fr]">
        <QuestionBankCategoriesPanel
          categories={filteredCategories}
          allSelected={allSelected}
          summaryMeta={summaryMeta}
          searchActive={search.trim().length > 0}
          selectedCategoryIds={selectedCategoryIds}
          selectedTopicKeys={selectedTopicKeys}
          expandedCategoryIds={expandedCategoryIds}
          selectedDifficulties={selectedDifficulties}
          questionSelection={questionSelection}
          selectionLabel={selectionLabel}
          onToggleAll={toggleAllCategories}
          onToggleCategory={toggleCategory}
          onToggleExpand={toggleExpandCategory}
          onToggleTopic={toggleTopic}
        />

        <QuestionBankControls
          sessionMode={sessionMode}
          selectedQuestions={selectedQuestions}
          boundedQuestionCount={boundedQuestionCount}
          selectedDifficulties={selectedDifficulties}
          questionSelection={questionSelection}
          selectionLabel={selectionLabel}
          onSessionModeChange={setSessionMode}
          onQuestionCountChange={setQuestionCount}
          onToggleDifficulty={toggleDifficulty}
          onQuestionSelectionChange={setQuestionSelection}
        />
      </div>
    </div>
  );
}
