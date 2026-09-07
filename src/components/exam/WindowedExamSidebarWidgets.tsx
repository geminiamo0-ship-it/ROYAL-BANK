'use client';

import React from 'react';
import Link from 'next/link';
import type { ExamClientAnswer, ExamClientQuestion } from '@/types/exam';

interface WindowedExamSidebarWidgetsProps {
  answers: Record<number, ExamClientAnswer>;
  answeredCount: number;
  bankId: number;
  currentIndex: number;
  isTimedMode: boolean;
  marks: number;
  question: ExamClientQuestion;
  questionIds: number[];
  sidebarHtml: string | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[4px] bg-[#394046] shadow-[0_1px_2px_rgba(0,0,0,0.2)]">
      {title ? (
        <div className="border-b border-[#4a5157] px-3 py-3 text-[15px] font-semibold text-white">
          {title}
        </div>
      ) : null}
      <div className="px-3 py-4">{children}</div>
    </section>
  );
}

export function WindowedExamSidebarWidgets({
  answers,
  answeredCount,
  bankId,
  currentIndex,
  isTimedMode,
  marks,
  question,
  questionIds,
  sidebarHtml,
}: WindowedExamSidebarWidgetsProps) {
  const scorePercent = answeredCount > 0 ? Math.round((marks / answeredCount) * 100) : 0;
  const benchmarkMarks = Number((answeredCount * 0.65).toFixed(1));
  const benchmarkDelta = Number((marks - benchmarkMarks).toFixed(1));

  const contentMapPresentation = question.topic || question.category || 'Clinical presentation';
  const contentMapCondition = question.category || question.topic || 'Clinical condition';
  const statusQuestionIds = questionIds.slice(0, Math.max(answeredCount, currentIndex + 1));

  return (
    <aside className="w-full shrink-0 space-y-4 lg:w-[476px]">
      <div className="grid gap-5 sm:grid-cols-[300px_156px]">
        <div className="space-y-4">
          <Section title="Textbooks">
            <div className="space-y-4">
              <Link
                href={`/bank/${bankId}/textbook/high-yield?note=${question.notes_id || ''}`}
                target="_blank"
                className="inline-flex rounded-[4px] bg-[#ffd7ea] px-3 py-[7px] text-[12px] text-[#561035] hover:bg-[#ffe2f0]"
              >
                High-yield textbook
              </Link>
              <div>
                <Link
                  href={`/bank/${bankId}/textbook/extended?note=${question.notes_id || ''}`}
                  target="_blank"
                  className="inline-flex rounded-[4px] bg-[#ffe6d2] px-3 py-[7px] text-[12px] text-[#5d2b0e] hover:bg-[#fff0e2]"
                >
                  Extended textbook
                </Link>
              </div>
            </div>
          </Section>

          <Section title="MRCP 1 Content Map">
            <div className="space-y-3">
              <div className="rounded-[6px] bg-[#a7abad] px-3 py-4">
                <div className="text-[11px] font-semibold uppercase text-[#5f6f7c]">Presentation</div>
                <div className="mt-3 inline-flex max-w-full rounded-full bg-white px-3 py-[6px] text-[12px] text-[#1f2933] shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
                  <span className="truncate">{contentMapPresentation}</span>
                </div>
              </div>

              <div className="rounded-[6px] bg-[#a7abad] px-3 py-4">
                <div className="text-[11px] font-semibold uppercase text-[#5f6f7c]">Condition</div>
                <div className="mt-3 inline-flex max-w-full rounded-full bg-white px-3 py-[6px] text-[12px] text-[#1f2933] shadow-[0_1px_2px_rgba(0,0,0,0.18)]">
                  <span className="truncate">{contentMapCondition}</span>
                </div>
              </div>

              <div className="text-right text-[11px] text-[#d486ff]">
                <button type="button" className="hover:text-white">
                  Suggest better categorisation
                </button>
              </div>
            </div>
          </Section>

          {sidebarHtml ? (
            <div
              className="pm-sidebar-extracted-panels"
              dangerouslySetInnerHTML={{ __html: sidebarHtml }}
            />
          ) : null}
        </div>

        <Section title="">
          <div className="text-center text-[13px] leading-6 text-[#d4d4d4]">
            {isTimedMode ? (
              <>
                <p>
                  Answered: <span className="font-semibold text-white">{answeredCount} / {questionIds.length}</span>
                </p>
                <p className="text-[11px] text-[#a8adb2]">Score is hidden until End Block.</p>
              </>
            ) : (
              <>
                <p>
                  Score: <span className="font-semibold text-white">{scorePercent}%</span>
                </p>
                <p>
                  Marks: <span className="font-semibold text-white">{marks} / {answeredCount}</span>
                </p>
                <p>
                  Benchmark: {benchmarkMarks} / {answeredCount}{' '}
                  <span className={benchmarkDelta >= 0 ? 'text-[#67e08d]' : 'text-[#ff5a68]'}>
                    ({benchmarkDelta >= 0 ? `+${benchmarkDelta}` : benchmarkDelta})
                  </span>
                </p>
              </>
            )}

            <div className="mt-4 border-t border-[#30363b] pt-4">
              <div className="mx-auto w-[72px] space-y-2 text-left">
                {statusQuestionIds.map((questionId, index) => {
                  const answer = answers[questionId];
                  const standardStatus = !answer
                    ? '-'
                    : answer.isCorrect === true
                      ? 'OK'
                      : answer.isCorrect === false
                        ? 'X'
                        : '…';
                  return (
                    <div key={questionId} className="grid grid-cols-[20px_1fr] items-center gap-5 text-[13px]">
                      <span className={index === currentIndex ? 'font-semibold text-[#b993ff]' : 'font-semibold text-[#a8adb2]'}>
                        {index + 1}
                      </span>
                      {isTimedMode ? (
                        <span className={answer ? 'text-[#7fc5ff]' : 'text-[#8a8f95]'}>
                          {answer ? '•' : '-'}
                        </span>
                      ) : (
                        <span className={
                          !answer
                            ? 'text-[#8a8f95]'
                            : answer.isCorrect === true
                              ? 'text-[#42c86e]'
                              : answer.isCorrect === false
                                ? 'text-[#ff253c]'
                                : 'text-[#a8adb2]'
                        }>
                          {standardStatus}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </aside>
  );
}
