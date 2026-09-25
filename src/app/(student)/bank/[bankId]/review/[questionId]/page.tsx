import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Flag, LockKeyhole, X } from 'lucide-react';
import {
  getLiveQuestionBankOutline,
  QuestionBankAccessError,
  QuestionBankAuthenticationError,
} from '@/lib/question-bank';
import { getRevisionQuestion, normalizeRevisionFilters } from '@/lib/revision';

function queryString(filters: ReturnType<typeof normalizeRevisionFilters>): string {
  const params = new URLSearchParams();
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.topic) params.set('topic', filters.topic);
  if (filters.difficulty !== 'all') params.set('difficulty', filters.difficulty);
  if (filters.q) params.set('q', filters.q);
  const value = params.toString();
  return value ? `?${value}` : '';
}

function answerDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export default async function RevisionQuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ bankId: string; questionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ bankId, questionId }, query] = await Promise.all([params, searchParams]);
  const parsedBankId = Number(bankId);
  const parsedQuestionId = Number(questionId);
  if (!Number.isInteger(parsedBankId) || parsedBankId <= 0) notFound();
  if (!Number.isInteger(parsedQuestionId) || parsedQuestionId <= 0) notFound();

  try {
    await getLiveQuestionBankOutline(parsedBankId);
  } catch (error) {
    if (error instanceof QuestionBankAuthenticationError) {
      redirect(`/login?redirect=/bank/${parsedBankId}/review/${parsedQuestionId}`);
    }
    if (error instanceof QuestionBankAccessError) {
      redirect(`/upgrade?bank=${parsedBankId}`);
    }
    throw error;
  }

  const filters = normalizeRevisionFilters(query);
  const detail = await getRevisionQuestion(parsedBankId, parsedQuestionId, filters);
  if (!detail) notFound();

  const suffix = queryString(filters);
  const backHref = `/bank/${parsedBankId}/review${suffix}`;
  const selectedOption = detail.question?.options.find((option) => option.id === detail.selectedOptionId) ?? null;
  const correctOption = detail.question?.options.find((option) => option.id === detail.feedback?.correct_option_id) ?? null;
  const optionLetter = (optionId: number | null | undefined) => {
    if (!detail.question || optionId == null) return '—';
    const index = detail.question.options.findIndex((option) => option.id === optionId);
    return index >= 0 ? String.fromCharCode(65 + index) : '—';
  };

  return (
    <div className="revision-passmed rv-detail">
      <div className="rv-detail-topline">
        <Link href={backHref} className="rv-back-link"><ArrowLeft /> Review questions</Link>
        <span className="rv-readonly-badge"><LockKeyhole /> Read-only mode</span>
      </div>

      <section className="rv-detail-card">
        <div className="rv-detail-head">
          <div>
            <span>Question {detail.position} of {detail.total}</span>
            <div className="rv-detail-tags">
              <span className={detail.isCorrect ? 'correct' : 'incorrect'}>
                {detail.isCorrect ? 'Correct' : 'Incorrect'}
              </span>
              <span>{detail.category}</span>
              {detail.topic ? <span>{detail.topic}</span> : null}
              {detail.isFlagged ? <span className="flag"><Flag /> Flagged</span> : null}
            </div>
          </div>
          <div className="rv-detail-nav-mini">
            {detail.previousQuestionId ? (
              <Link href={`/bank/${parsedBankId}/review/${detail.previousQuestionId}${suffix}`} aria-label="Previous question">‹</Link>
            ) : <span className="disabled">‹</span>}
            {detail.nextQuestionId ? (
              <Link href={`/bank/${parsedBankId}/review/${detail.nextQuestionId}${suffix}`} aria-label="Next question">›</Link>
            ) : <span className="disabled">›</span>}
          </div>
        </div>

        {detail.question ? (
          <>
            <div
              className="rv-stem"
              dangerouslySetInnerHTML={{ __html: detail.question.text_html }}
            />

            <div className="rv-options">
              {detail.question.options.map((option) => {
                const isSelected = option.id === detail.selectedOptionId;
                const isCorrect = option.id === detail.feedback?.correct_option_id;
                const className = isCorrect
                  ? 'rv-option correct'
                  : isSelected && !detail.isCorrect
                    ? 'rv-option incorrect'
                    : 'rv-option';

                return (
                  <div key={option.id} className={className}>
                    <span className="rv-option-dot" />
                    <div className="rv-option-text" dangerouslySetInnerHTML={{ __html: option.text_html }} />
                    {isSelected ? <span className="rv-option-state">{detail.isCorrect ? <Check /> : <X />} Your answer</span> : null}
                    {isCorrect ? <span className="rv-option-state correct-state"><Check /> Correct answer</span> : null}
                  </div>
                );
              })}
            </div>

            <div className="rv-answer-summary">
              <div>
                <span>Your answer</span>
                <strong className={detail.isCorrect ? 'correct-text' : 'incorrect-text'}>
                  {selectedOption ? optionLetter(selectedOption.id) : '—'}
                </strong>
              </div>
              <div>
                <span>Correct answer</span>
                <strong className="correct-text">{correctOption ? optionLetter(correctOption.id) : '—'}</strong>
              </div>
              <div>
                <span>Answered on</span>
                <strong>{answerDate(detail.answeredAt)}</strong>
              </div>
            </div>

            <section className="rv-explanation">
              <h2>Explanation</h2>
              {detail.feedback?.explanation_html ? (
                <div dangerouslySetInnerHTML={{ __html: detail.feedback.explanation_html }} />
              ) : (
                <p>Explanation content is unavailable for this historical question release.</p>
              )}
            </section>
          </>
        ) : (
          <div className="rv-content-unavailable">
            This historical question content is unavailable from its pinned release.
          </div>
        )}

        <div className="rv-detail-footer">
          {detail.previousQuestionId ? (
            <Link href={`/bank/${parsedBankId}/review/${detail.previousQuestionId}${suffix}`}>
              <ArrowLeft /> Previous question
            </Link>
          ) : <span />}

          {detail.nextQuestionId ? (
            <Link href={`/bank/${parsedBankId}/review/${detail.nextQuestionId}${suffix}`} className="primary">
              Next question <ArrowRight />
            </Link>
          ) : <Link href={backHref} className="primary">Back to review <ArrowRight /></Link>}
        </div>
      </section>
    </div>
  );
}
