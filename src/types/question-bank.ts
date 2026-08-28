export interface TopicSummary {
  id: string;
  name: string;
  total: number;
  attempted: number;
  newCount: number;
  incorrectCount: number;
  flaggedCount: number;
  suspendedCount: number;
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
  topics: TopicSummary[];
}
