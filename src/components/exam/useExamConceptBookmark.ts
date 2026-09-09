'use client';

import { useCallback, useMemo, useState } from 'react';
import { removeSavedConcept, saveConceptVote } from '@/actions/exam';
import type { ExamClientQuestion } from '@/types/exam';

function htmlToPlainText(html: string) {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const element = document.createElement('div');
  element.innerHTML = html;
  return element.textContent?.replace(/\s+/g, ' ').trim() || html;
}

export function useExamConceptBookmark(question: ExamClientQuestion | undefined) {
  const [bookmarkedConceptKeys, setBookmarkedConceptKeys] = useState<Set<string>>(new Set());
  const [pendingConceptKey, setPendingConceptKey] = useState<string | null>(null);

  const conceptKey = useMemo(
    () => question ? question.concept_id || String(question.id) : '',
    [question],
  );
  const isBookmarked = conceptKey ? bookmarkedConceptKeys.has(conceptKey) : false;

  const toggleBookmark = useCallback(async (conceptHtml: string | null) => {
    if (!question || !conceptKey || !conceptHtml || pendingConceptKey) return;

    setPendingConceptKey(conceptKey);

    if (bookmarkedConceptKeys.has(conceptKey)) {
      setBookmarkedConceptKeys((previous) => {
        const next = new Set(previous);
        next.delete(conceptKey);
        return next;
      });

      try {
        await removeSavedConcept(question.id);
      } catch {
        setBookmarkedConceptKeys((previous) => new Set(previous).add(conceptKey));
      } finally {
        setPendingConceptKey(null);
      }
      return;
    }

    setBookmarkedConceptKeys((previous) => new Set(previous).add(conceptKey));
    try {
      await saveConceptVote({
        questionId: question.id,
        conceptText: htmlToPlainText(conceptHtml),
        isImportant: true,
      });
    } catch {
      setBookmarkedConceptKeys((previous) => {
        const next = new Set(previous);
        next.delete(conceptKey);
        return next;
      });
    } finally {
      setPendingConceptKey(null);
    }
  }, [bookmarkedConceptKeys, conceptKey, pendingConceptKey, question]);

  return {
    isBookmarked,
    toggleBookmark,
  };
}
