import type { QuestionSelection } from '@/types/database';
import type { CategoryWithTopics } from '@/types/question-bank';

export const QUESTION_SELECTION_OPTIONS: Array<{
  value: QuestionSelection;
  label: string;
}> = [
  { value: 'new_only', label: 'Show me new questions only' },
  { value: 'all', label: 'Show me all available questions' },
  { value: 'incorrect_only', label: 'Only previously incorrect questions' },
  { value: 'flagged_only', label: 'Only flagged questions' },
  { value: 'suspended_only', label: 'Suspended / incomplete questions' },
];

type SelectableCounts = Pick<
  CategoryWithTopics,
  | 'totalByDiff'
  | 'attemptedByDiff'
  | 'incorrectByDiff'
  | 'flaggedByDiff'
  | 'suspendedByDiff'
>;

export function getCountForSelection(
  item: SelectableCounts,
  selection: QuestionSelection,
  difficulties: string[],
) {
  const sum = (counts: Record<string, number>) =>
    difficulties.reduce((acc, difficulty) => acc + (counts[difficulty] || 0), 0);

  switch (selection) {
    case 'new_only':
      return Math.max(
        sum(item.totalByDiff) - sum(item.attemptedByDiff) - sum(item.suspendedByDiff),
        0,
      );
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

export function getSelectionLabel(selection: QuestionSelection) {
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

export function topicSelectionKey(categoryId: string, topicId: string) {
  return `${categoryId}|||${topicId}`;
}
