export type AiSearchChunk = {
  id?: string;
  score?: number;
  text?: string;
  item?: {
    key?: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
  };
  scoring_details?: Record<string, unknown>;
};

export type AiSearchResult = {
  search_query?: string;
  chunks?: AiSearchChunk[];
};

export type AiSearchInstanceHandle = {
  search(input: {
    messages?: Array<{ role: string; content: string }>;
    query?: string;
    ai_search_options?: Record<string, unknown>;
  }): Promise<AiSearchResult>;
};

export type AiSearchNamespaceHandle = {
  get(name: string): AiSearchInstanceHandle;
};

export type RoyalAiUsageEvent = {
  eventId: string;
  userId: string;
  conversationId: string;
  requestId: string;
  model: string;
  promptVersion: string;
  groundingMode: 'royal' | 'general';
  sourceCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  retrievalMs: number;
  firstTokenMs: number;
  generationMs: number;
  totalMs: number;
  createdAt: string;
};

export interface RoyalAiEnv {
  APP_ENV: string;
  SERVICE_NAME: string;
  SUPABASE_PROJECT_REF: string;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  OPENROUTER_API_KEY: string;
  AI_SEARCH_INSTANCE: string;
  ROYAL_AI_SYNC_QUEUE_NAME: string;
  ROYAL_AI_USERS: DurableObjectNamespace<import('./user-state').RoyalAiUserState>;
  AI_SEARCH: AiSearchNamespaceHandle;
  ROYAL_AI_SYNC_QUEUE: Queue<RoyalAiUsageEvent>;
}
