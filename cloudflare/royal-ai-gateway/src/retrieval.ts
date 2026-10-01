import type { RoyalAiConfig } from './config';
import type { AiSearchChunk, RoyalAiEnv } from './env';

export type RoyalAiSource = {
  id: string;
  title: string;
  key: string;
  articleId: string | null;
  bankId: number | null;
  text: string;
  score: number;
};

function titleFromKey(key: string): string {
  const file = key.split('/').filter(Boolean).pop() || 'Royal medical source';
  const withoutExt = file.replace(/\.[^.]+$/, '').replace(/^\d+--/, '');
  return withoutExt
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Royal medical source';
}

export async function retrieveRoyalKnowledge(
  env: RoyalAiEnv,
  input: {
    message: string;
    recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
    config: RoyalAiConfig;
  },
): Promise<{ sources: RoyalAiSource[]; retrievalMs: number; searchQuery: string | null }> {
  const started = performance.now();
  try {
    const instance = env.AI_SEARCH.get(env.AI_SEARCH_INSTANCE);
    const messages = [
      ...input.recentMessages.slice(-6).map((message) => ({
        role: message.role,
        content: message.content.slice(0, 4000),
      })),
      { role: 'user', content: input.message },
    ];

    const result = await instance.search({
      messages,
      ai_search_options: {
        retrieval: {
          retrieval_type: 'hybrid',
          fusion_method: 'rrf',
          match_threshold: 0.4,
          max_num_results: input.config.retrievalCandidates,
        },
        reranking: {
          enabled: true,
          model: '@cf/baai/bge-reranker-base',
        },
        query_rewrite: {
          enabled: true,
        },
      },
    });

    const chunks = Array.isArray(result.chunks) ? result.chunks : [];
    const sources = chunks
      .filter((chunk): chunk is AiSearchChunk & { text: string } =>
        typeof chunk.text === 'string' && chunk.text.trim().length > 0,
      )
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, input.config.retrievalFinal)
      .map((chunk, index) => {
        const key = String(chunk.item?.key || '');
        return {
          id: `[S${index + 1}]`,
          title: titleFromKey(key),
          key,
          articleId: key.split('/').pop()?.match(/^(\d+)--/)?.[1] || null,
          bankId: (() => {
            const matched = key.match(/(?:^|\/)bank-(\d+)(?:\/|$)/)?.[1];
            const parsed = matched ? Number(matched) : NaN;
            return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
          })(),
          text: chunk.text.trim().slice(0, 12_000),
          score: Number(chunk.score || 0),
        };
      });

    return {
      sources,
      retrievalMs: performance.now() - started,
      searchQuery: typeof result.search_query === 'string' ? result.search_query : null,
    };
  } catch (error) {
    console.error('ROYAL_AI_RETRIEVAL_FAILED', error);
    return { sources: [], retrievalMs: performance.now() - started, searchQuery: null };
  }
}
