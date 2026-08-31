export type DifficultyCounts = { '1': number; '2': number; '3': number; [key: string]: number };

export interface TopicSummary {
  id: string;
  name: string;
  total: number;
  attempted: number;
  newCount: number;
  incorrectCount: number;
  flaggedCount: number;
  suspendedCount: number;
  // Breakdowns
  totalByDiff: DifficultyCounts;
  attemptedByDiff: DifficultyCounts;
  incorrectByDiff: DifficultyCounts;
  flaggedByDiff: DifficultyCounts;
  suspendedByDiff: DifficultyCounts;
}

export interface CategoryWithTopics {
  id: string;
  name: string;
  total: number;
  attempted: number;
  newCount: number;
  incorrectCount: number;
  flaggedCount: number;
  suspendedCount: number;
  // Breakdowns
  totalByDiff: DifficultyCounts;
  attemptedByDiff: DifficultyCounts;
  incorrectByDiff: DifficultyCounts;
  flaggedByDiff: DifficultyCounts;
  suspendedByDiff: DifficultyCounts;
  topics: TopicSummary[];
}
