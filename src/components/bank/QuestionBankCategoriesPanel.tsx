'use client';

import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { QuestionBankPanelHeader } from '@/components/bank/QuestionBankPanelHeader';
import { getCountForSelection, topicSelectionKey } from '@/lib/question-bank-selection';
import type { QuestionSelection } from '@/types/database';
import type { CategoryWithTopics, TopicSummary } from '@/types/question-bank';

interface QuestionBankCategoriesPanelProps {
  categories: CategoryWithTopics[];
  allSelected: boolean;
  summaryMeta: string;
  searchActive: boolean;
  selectedCategoryIds: string[];
  selectedTopicKeys: string[];
  expandedCategoryIds: string[];
  selectedDifficulties: string[];
  questionSelection: QuestionSelection;
  selectionLabel: string;
  onToggleAll: () => void;
  onToggleCategory: (categoryId: string) => void;
  onToggleExpand: (categoryId: string) => void;
  onToggleTopic: (categoryId: string, topic: TopicSummary) => void;
}

export function QuestionBankCategoriesPanel({
  categories,
  allSelected,
  summaryMeta,
  searchActive,
  selectedCategoryIds,
  selectedTopicKeys,
  expandedCategoryIds,
  selectedDifficulties,
  questionSelection,
  selectionLabel,
  onToggleAll,
  onToggleCategory,
  onToggleExpand,
  onToggleTopic,
}: QuestionBankCategoriesPanelProps) {
  return (
    <section className="rounded-[4px] bg-[#353c42] shadow-[0_1px_3px_rgba(0,0,0,0.28)]">
      <QuestionBankPanelHeader title="Categories" />
      <div className="px-[12px] pb-[12px]">
        <CategoryRow
          checked={allSelected}
          title="All"
          meta={summaryMeta}
          onToggle={onToggleAll}
          strong
        />

        <div className="mt-[2px] space-y-[1px]">
          {categories.map((category) => {
            const isExpanded =
              expandedCategoryIds.includes(category.id) ||
              (searchActive && category.topics.length > 0);

            return (
              <div key={category.id}>
                <CategoryRow
                  checked={selectedCategoryIds.includes(category.id)}
                  title={category.name}
                  meta={
                    questionSelection === 'all'
                      ? `${selectedDifficulties.reduce((sum, difficulty) => sum + (category.attemptedByDiff[difficulty] || 0), 0)} of ${getCountForSelection(category, 'all', selectedDifficulties).toLocaleString()}`
                      : `${getCountForSelection(category, questionSelection, selectedDifficulties).toLocaleString()} ${selectionLabel}`
                  }
                  onToggle={() => onToggleCategory(category.id)}
                  canExpand={category.topics.length > 0}
                  expanded={isExpanded}
                  onToggleExpand={() => onToggleExpand(category.id)}
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
                              onChange={() => onToggleTopic(category.id, topic)}
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
