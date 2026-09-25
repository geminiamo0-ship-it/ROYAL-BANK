'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Flag,
  Hammer,
  Search,
  X,
} from 'lucide-react';
import type {
  RevisionFilters,
  RevisionIndex,
  RevisionStatusFilter,
} from '@/lib/revision';

function displayDate(value: string): { top: string; bottom: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { top: '—', bottom: '' };
  const top = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(date);
  return { top, bottom: String(date.getFullYear()).slice(-2) };
}

function statusLabel(filter: RevisionStatusFilter): string {
  if (filter === 'incorrect') return 'Incorrect';
  if (filter === 'correct') return 'Correct';
  if (filter === 'flagged') return 'Flagged questions';
  return 'All questions';
}

export function RevisionQuestionsClient({
  bankId,
  index,
  filters,
}: {
  bankId: number;
  index: RevisionIndex;
  filters: RevisionFilters;
}) {
  const router = useRouter();
  const [searchValue, setSearchValue] = useState(filters.q);
  const basePath = `/bank/${bankId}/review`;

  const hrefFor = useMemo(() => {
    return (changes: Partial<RevisionFilters>) => {
      const next = { ...filters, ...changes };
      const params = new URLSearchParams();

      if (next.status !== 'all') params.set('status', next.status);
      if (next.category) params.set('category', next.category);
      if (next.topic) params.set('topic', next.topic);
      if (next.difficulty !== 'all') params.set('difficulty', next.difficulty);
      if (next.q) params.set('q', next.q);
      if (next.page > 1) params.set('page', String(next.page));

      const query = params.toString();
      return query ? `${basePath}?${query}` : basePath;
    };
  }, [basePath, filters]);

  const pushChanges = (changes: Partial<RevisionFilters>) => {
    router.push(hrefFor({ ...changes, page: changes.page ?? 1 }));
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    pushChanges({ q: searchValue.trim(), page: 1 });
  };

  return (
    <div className="revision-passmed">
      <section className="rv-hero">
        <div>
          <h1>Review questions</h1>
          <p>Revisit your previous answers without changing your question history.</p>
        </div>
        <div className="rv-hero-mark" aria-hidden="true">♛</div>
      </section>

      <section className="rv-toolbar">
        <div className="rv-tabs">
          <button type="button" className="active">Questions</button>
        </div>

        <form className="rv-search" onSubmit={submitSearch}>
          <Search aria-hidden="true" />
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search topic, category or question ID..."
            aria-label="Search revision questions by topic, category or question ID"
          />
        </form>
      </section>

      <div className="rv-layout">
        <aside className="rv-filters">
          <div className="rv-filter-card">
            <div className="rv-filter-heading">Categories &amp; topics</div>

            <FilterRow
              label="All"
              count={index.totals.answered}
              selected={!filters.category && !filters.topic}
              onClick={() => pushChanges({ category: null, topic: null, page: 1 })}
            />

            <div className="rv-category-list">
              {index.categories.map((category) => {
                const expanded = filters.category === category.name;
                return (
                  <div key={category.name} className="rv-taxonomy-group">
                    <FilterRow
                      label={category.name}
                      count={category.count}
                      selected={expanded && !filters.topic}
                      expandable
                      expanded={expanded}
                      onClick={() => pushChanges({
                        category: expanded ? null : category.name,
                        topic: null,
                        page: 1,
                      })}
                    />

                    {expanded && category.topics.length > 0 ? (
                      <div className="rv-topic-list">
                        <button
                          type="button"
                          className={!filters.topic ? 'rv-topic-row active' : 'rv-topic-row'}
                          onClick={() => pushChanges({ category: category.name, topic: null, page: 1 })}
                        >
                          <span>All {category.name}</span>
                          <b>{category.count.toLocaleString()}</b>
                        </button>

                        {category.topics.map((topic) => (
                          <button
                            key={topic.name}
                            type="button"
                            className={filters.topic === topic.name ? 'rv-topic-row active' : 'rv-topic-row'}
                            onClick={() => pushChanges({
                              category: category.name,
                              topic: topic.name,
                              page: 1,
                            })}
                          >
                            <span>{topic.name}</span>
                            <b>{topic.count.toLocaleString()}</b>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="rv-filter-section">
              <div className="rv-filter-heading">Question status</div>
              <div className="rv-button-grid">
                {(['all', 'incorrect', 'correct', 'flagged'] as RevisionStatusFilter[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={filters.status === value ? 'active' : ''}
                    onClick={() => pushChanges({ status: value, page: 1 })}
                  >
                    {statusLabel(value)}
                  </button>
                ))}
              </div>
            </div>

            <div className="rv-filter-section">
              <div className="rv-filter-heading">Difficulty level</div>
              <div className="rv-difficulty-grid">
                <button
                  type="button"
                  className={filters.difficulty === 'all' ? 'active wide' : 'wide'}
                  onClick={() => pushChanges({ difficulty: 'all', page: 1 })}
                >
                  All difficulties
                </button>
                {(['1', '2', '3'] as const).map((difficulty) => (
                  <button
                    key={difficulty}
                    type="button"
                    className={filters.difficulty === difficulty ? 'active' : ''}
                    onClick={() => pushChanges({ difficulty, page: 1 })}
                    aria-label={`Difficulty ${difficulty}`}
                  >
                    {Array.from({ length: Number(difficulty) }, (_, indexValue) => (
                      <Hammer key={indexValue} aria-hidden="true" />
                    ))}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="rv-results">
          <div className="rv-results-head">
            <div>
              <strong>{index.totalFiltered.toLocaleString()} available question{index.totalFiltered === 1 ? '' : 's'}</strong>
              <span>Showing up to {index.pageSize} questions per page · newest answered first</span>
            </div>
            {(filters.category || filters.topic || filters.status !== 'all' || filters.difficulty !== 'all' || filters.q) ? (
              <Link href={basePath}>Clear filters</Link>
            ) : null}
          </div>

          {index.items.length > 0 ? (
            <div className="rv-question-list">
              {index.items.map((item) => {
                const date = displayDate(item.answeredAt);
                const query = new URLSearchParams();
                if (filters.status !== 'all') query.set('status', filters.status);
                if (filters.category) query.set('category', filters.category);
                if (filters.topic) query.set('topic', filters.topic);
                if (filters.difficulty !== 'all') query.set('difficulty', filters.difficulty);
                if (filters.q) query.set('q', filters.q);
                const detailHref = `${basePath}/${item.questionId}${query.size ? `?${query.toString()}` : ''}`;

                return (
                  <article key={item.questionId} className="rv-question-row">
                    <div className="rv-question-date">
                      <strong>{date.top}</strong>
                      <span>{date.bottom}</span>
                    </div>

                    <div className="rv-question-copy">
                      <h2>{item.topic || `Question ${item.questionId}`}</h2>
                      <p>
                        <span className="rv-question-taxonomy">{item.category}{item.topic ? ` · ${item.topic}` : ''}</span>
                        {item.preview ? ` — ${item.preview}` : ''}
                      </p>
                    </div>

                    <div className="rv-question-icons" aria-label={`Difficulty ${item.difficulty}`}>
                      {Array.from({ length: Math.max(1, Math.min(3, Number(item.difficulty) || 1)) }, (_, difficultyIndex) => (
                        <Hammer key={difficultyIndex} aria-hidden="true" />
                      ))}
                    </div>

                    <div className="rv-question-state">
                      {item.isFlagged ? <Flag className="flagged" aria-label="Flagged" /> : null}
                      {item.isCorrect ? (
                        <Check className="correct" aria-label="Correct" />
                      ) : (
                        <X className="incorrect" aria-label="Incorrect" />
                      )}
                    </div>

                    <Link href={detailHref} className="rv-review-link">
                      Review <ChevronRight aria-hidden="true" />
                    </Link>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rv-empty">
              <strong>No reviewed questions match these filters.</strong>
              <span>Change the category, topic, status, difficulty or search.</span>
            </div>
          )}

          <div className="rv-pagination">
            <span>
              Page {index.page} of {index.pageCount}
            </span>
            <div>
              <button
                type="button"
                disabled={index.page <= 1}
                onClick={() => pushChanges({ page: Math.max(1, index.page - 1) })}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </button>
              <span>{index.page} / {index.pageCount}</span>
              <button
                type="button"
                disabled={index.page >= index.pageCount}
                onClick={() => pushChanges({ page: Math.min(index.pageCount, index.page + 1) })}
                aria-label="Next page"
              >
                <ChevronRight />
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function FilterRow({
  label,
  count,
  selected,
  expandable = false,
  expanded = false,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`rv-filter-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className="rv-filter-check">{selected ? <Check /> : null}</span>
      <span className="rv-filter-label">{label}</span>
      <span className="rv-filter-count">{count.toLocaleString()}</span>
      {expandable ? (
        <span className={expanded ? 'rv-filter-plus expanded' : 'rv-filter-plus'}>
          <ChevronDown aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );
}
