'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
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
      if (next.difficulty !== 'all') params.set('difficulty', next.difficulty);
      if (next.q) params.set('q', next.q);
      if (next.sort !== 'date') params.set('sort', next.sort);
      if (next.page > 1) params.set('page', String(next.page));
      const query = params.toString();
      return query ? `${basePath}?${query}` : basePath;
    };
  }, [basePath, filters]);

  const pushChanges = (changes: Partial<RevisionFilters>) => {
    router.push(hrefFor({ ...changes, page: changes.page ?? 1 }));
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    pushChanges({ q: searchValue.trim(), page: 1 });
  };

  return (
    <div className="revision-passmed">
      <section className="rv-hero">
        <div>
          <h1>Review questions and key concepts</h1>
          <p>Revisit previously attempted questions and reinforce key concepts.</p>
        </div>
        <div className="rv-hero-mark" aria-hidden="true">♛</div>
      </section>

      <section className="rv-toolbar">
        <div className="rv-tabs">
          <button type="button" className="active">Questions</button>
          <button type="button" disabled title="Key concepts will be added later">Key concepts</button>
        </div>

        <form className="rv-search" onSubmit={submitSearch}>
          <Search aria-hidden="true" />
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search questions..."
            aria-label="Search review questions"
          />
        </form>

        <div className="rv-sort">
          <button
            type="button"
            className={filters.sort === 'date' ? 'active' : ''}
            onClick={() => pushChanges({ sort: 'date', page: 1 })}
          >
            Sort by date
          </button>
          <button
            type="button"
            className={filters.sort === 'alpha' ? 'active' : ''}
            onClick={() => pushChanges({ sort: 'alpha', page: 1 })}
          >
            Sort alphabetically
          </button>
        </div>
      </section>

      <div className="rv-layout">
        <aside className="rv-filters">
          <div className="rv-filter-card">
            <div className="rv-filter-heading">Systems &amp; topics</div>

            <FilterRow
              label="All"
              count={index.totals.answered}
              selected={!filters.category}
              onClick={() => pushChanges({ category: null, page: 1 })}
            />

            <div className="rv-category-list">
              {index.categories.map((category) => (
                <FilterRow
                  key={category.name}
                  label={category.name}
                  count={category.count}
                  selected={filters.category === category.name}
                  expandable
                  onClick={() => pushChanges({
                    category: filters.category === category.name ? null : category.name,
                    page: 1,
                  })}
                />
              ))}
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
          {index.items.length > 0 ? (
            <div className="rv-question-list">
              {index.items.map((item) => {
                const date = displayDate(item.answeredAt);
                const query = new URLSearchParams();
                if (filters.status !== 'all') query.set('status', filters.status);
                if (filters.category) query.set('category', filters.category);
                if (filters.difficulty !== 'all') query.set('difficulty', filters.difficulty);
                if (filters.q) query.set('q', filters.q);
                if (filters.sort !== 'date') query.set('sort', filters.sort);
                const detailHref = `${basePath}/${item.questionId}${query.size ? `?${query.toString()}` : ''}`;

                return (
                  <article key={item.questionId} className="rv-question-row">
                    <div className="rv-question-date">
                      <strong>{date.top}</strong>
                      <span>{date.bottom}</span>
                    </div>

                    <div className="rv-question-copy">
                      <h2>{item.title}</h2>
                      <p>{item.preview || `${item.category}${item.topic ? ` · ${item.topic}` : ''}`}</p>
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
              <span>Change the filters or clear the search.</span>
            </div>
          )}

          <div className="rv-pagination">
            <span>
              {index.totalFiltered.toLocaleString()} question{index.totalFiltered === 1 ? '' : 's'}
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
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  expandable?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`rv-filter-row ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className="rv-filter-check">{selected ? <Check /> : null}</span>
      <span className="rv-filter-label">{label}</span>
      <span className="rv-filter-count">{count.toLocaleString()}</span>
      {expandable ? <span className="rv-filter-plus">+</span> : null}
    </button>
  );
}
